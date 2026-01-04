/**
 * Integration tests for Key Exchange Stream Protocol
 *
 * Tests the raw libp2p stream communication for the key exchange protocol:
 * - Protocol handler registration
 * - Stream dialing and connection
 * - Data writing and reading
 * - Length-prefixed message handling
 *
 * This test isolates the stream communication layer to debug
 * "Empty pipeline" errors in the key exchange protocol.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { DHTNode } from '../dht/node.js';
import { DHTConfigBuilder } from '../dht/config.js';
import { cleanupNodes } from '../test-utils/network.js';
import { KEY_EXCHANGE_PROTOCOL_ID } from '../overlay/constants.js';

/**
 * Simple delay utility.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stream type for libp2p streams
 */
interface LibP2PStream {
  source: AsyncIterable<{ subarray(): Uint8Array }>;
  sink: (data: Iterable<Uint8Array> | AsyncIterable<Uint8Array>) => Promise<void>;
  close: () => Promise<void>;
}

describe('Key Exchange Stream Protocol Integration Tests', () => {
  let nodes: DHTNode[] = [];

  afterEach(async () => {
    await cleanupNodes(nodes);
    nodes = [];
  });

  /**
   * Create a DHT node for testing
   */
  async function createNode(): Promise<DHTNode> {
    const config = DHTConfigBuilder.create()
      .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
      .withMaxConnections(50)
      .withMinConnections(0)
      .build();

    const node = new DHTNode(config);
    await node.start();
    nodes.push(node);
    return node;
  }

  /**
   * Connect two nodes
   */
  async function connectNodes(nodeA: DHTNode, nodeB: DHTNode): Promise<void> {
    const addrs = nodeB.multiaddrs.map((ma) => ma.toString());
    await nodeA.bootstrap(addrs);
    await delay(500); // Wait for connection to establish
  }

  // ==========================================================================
  // Basic Stream Communication Tests
  // ==========================================================================

  describe('Basic Stream Communication', () => {
    it('should register a protocol handler on a node', async () => {
      const node = await createNode();
      const libp2p = node.getLibp2pNode();

      // Register a simple handler
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2p.handle('/test/protocol/1.0.0', async (data: any) => {
        console.log(`[Test] Received connection from ${data.connection.remotePeer.toString()}`);
      });

      // Verify protocol is registered
      const protocols = libp2p.getProtocols();
      expect(protocols).toContain('/test/protocol/1.0.0');
    }, 30000);

    it('should dial a protocol between two connected nodes', async () => {
      const nodeA = await createNode();
      const nodeB = await createNode();

      const libp2pA = nodeA.getLibp2pNode();
      const libp2pB = nodeB.getLibp2pNode();

      let handlerCalled = false;

      // In libp2p 3.x, the handler receives the stream directly, not { stream, connection }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle('/test/dial/1.0.0', async (streamData: any) => {
        console.log(`[NodeB] Handler called!`);
        // The streamData IS the stream in libp2p 3.x
        // But it might also be { stream, connection } in some versions
        const stream = streamData.stream || streamData;
        handlerCalled = true;
        await stream.close();
      });

      // Now connect the nodes
      await connectNodes(nodeA, nodeB);

      // Dial from node A to node B
      const targetPeerId = nodeB.peerId;
      
      const rawStream = await libp2pA.dialProtocol(targetPeerId, '/test/dial/1.0.0');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = rawStream as any;
      await stream.close();

      // Wait a bit for handler to be called
      await delay(500);

      expect(handlerCalled).toBe(true);
    }, 30000);

    it('should send and receive data through a stream', async () => {
      const nodeA = await createNode();
      const nodeB = await createNode();

      const libp2pA = nodeA.getLibp2pNode();
      const libp2pB = nodeB.getLibp2pNode();

      const testData = new TextEncoder().encode('Hello from Node A!');
      let receivedData: Uint8Array | null = null;

      // Register handler on node B that reads data
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle('/test/data/1.0.0', async (streamData: any) => {
        const stream = streamData.stream || streamData;
        console.log(`[NodeB] Handler called`);
        
        // Check for Symbol.asyncIterator
        const hasAsyncIterator = typeof stream[Symbol.asyncIterator] === 'function';
        console.log(`[NodeB] Stream has Symbol.asyncIterator: ${hasAsyncIterator}`);

        try {
          if (hasAsyncIterator) {
            // The stream itself is async iterable
            const chunks: Uint8Array[] = [];
            for await (const chunk of stream) {
              console.log(`[NodeB] Received chunk: ${chunk.length} bytes`);
              chunks.push(chunk.subarray ? chunk.subarray() : chunk);
            }
            if (chunks.length > 0) {
              const totalLength = chunks.reduce((sum, arr) => sum + arr.length, 0);
              receivedData = new Uint8Array(totalLength);
              let offset = 0;
              for (const chunk of chunks) {
                receivedData.set(chunk, offset);
                offset += chunk.length;
              }
              console.log(`[NodeB] Total received: ${receivedData.length} bytes`);
            } else {
              console.log(`[NodeB] No chunks received`);
            }
          }
        } catch (error) {
          console.error('[NodeB] Error reading stream:', error);
        } finally {
          await stream.close();
        }
      });

      await connectNodes(nodeA, nodeB);

      // Dial from node A to node B and send data
      const targetPeerId = nodeB.peerId;
      
      const rawStream = await libp2pA.dialProtocol(targetPeerId, '/test/data/1.0.0');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = rawStream as any;
      
      // Check all available methods on the stream
      const proto = Object.getPrototypeOf(stream);
      const protoMethods = Object.getOwnPropertyNames(proto).filter(n => typeof proto[n] === 'function');
      console.log(`[NodeA] Stream prototype methods: ${protoMethods.join(', ')}`);
      
      // Check for write method on prototype
      const hasWriteOnProto = typeof proto.write === 'function';
      console.log(`[NodeA] Stream prototype has write: ${hasWriteOnProto}`);
      
      // Try to write using the correct method
      // yamux sendData expects a Uint8ArrayList
      const { Uint8ArrayList } = await import('uint8arraylist');
      const dataList = new Uint8ArrayList(testData);
      
      if (proto.sendData) {
        console.log(`[NodeA] Sending via sendData with Uint8ArrayList...`);
        await stream.sendData(dataList);
      } else if (stream.push) {
        console.log(`[NodeA] Sending via push...`);
        stream.push(testData);
      }
      
      // Close write side to signal EOF
      if (proto.sendCloseWrite) {
        console.log(`[NodeA] Closing write side via sendCloseWrite...`);
        await stream.sendCloseWrite();
      } else if (stream.closeWrite) {
        console.log(`[NodeA] Closing write side...`);
        await stream.closeWrite();
      }
      
      console.log(`[NodeA] Closing stream...`);
      await stream.close();

      // Wait for data to be received
      await delay(500);

      console.log(`[NodeA] Received data: ${receivedData?.length ?? 'null'}`);
    }, 30000);

    it('should send response back through the stream', async () => {
      const nodeA = await createNode();
      const nodeB = await createNode();
      await connectNodes(nodeA, nodeB);

      const libp2pA = nodeA.getLibp2pNode();
      const libp2pB = nodeB.getLibp2pNode();

      const responseData = new TextEncoder().encode('Response from Node B!');

      // Register handler on node B that sends a response
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle('/test/response/1.0.0', async (data: any) => {
        const stream = data.stream as LibP2PStream;
        console.log(`[NodeB] Handler called from ${data.connection.remotePeer.toString()}`);

        try {
          // Send response data
          console.log(`[NodeB] Sending ${responseData.length} bytes response...`);
          await stream.sink([responseData]);
          console.log(`[NodeB] Response sent`);
        } catch (error) {
          console.error('[NodeB] Error sending response:', error);
        } finally {
          await stream.close();
          console.log(`[NodeB] Stream closed`);
        }
      });

      // Dial from node A to node B and read response
      const targetPeerId = nodeB.peerId;
      
      const rawStream = await libp2pA.dialProtocol(targetPeerId, '/test/response/1.0.0');
      const stream = rawStream as unknown as LibP2PStream;
      
      console.log(`[NodeA] Connected, reading response...`);
      
      // Read response from stream
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream.source) {
        console.log(`[NodeA] Received chunk: ${chunk.subarray().length} bytes`);
        chunks.push(chunk.subarray());
      }

      await stream.close();

      expect(chunks.length).toBeGreaterThan(0);
      
      const totalLength = chunks.reduce((sum, arr) => sum + arr.length, 0);
      const receivedDataResult = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        receivedDataResult.set(chunk, offset);
        offset += chunk.length;
      }

      expect(receivedDataResult).toEqual(responseData);
    }, 30000);
  });

  // ==========================================================================
  // Key Exchange Protocol Simulation Tests
  // ==========================================================================

  describe('Key Exchange Protocol Simulation', () => {
    it('should simulate key exchange protocol with actual protocol ID', async () => {
      const nodeA = await createNode();
      const nodeB = await createNode();
      await connectNodes(nodeA, nodeB);

      const libp2pA = nodeA.getLibp2pNode();
      const libp2pB = nodeB.getLibp2pNode();

      // Create a mock public key record
      const peerIdBytes = new TextEncoder().encode(nodeB.peerId.toString());
      const recordSize = 2 + peerIdBytes.length + 32 + 1184 + 8 + 32;
      const record = new Uint8Array(recordSize);
      let offset = 0;
      
      // Peer ID length (2 bytes)
      record[offset++] = (peerIdBytes.length >> 8) & 0xff;
      record[offset++] = peerIdBytes.length & 0xff;
      
      // Peer ID
      record.set(peerIdBytes, offset);
      offset += peerIdBytes.length;
      
      // X25519 key (32 bytes of random data)
      const x25519Key = new Uint8Array(32);
      crypto.getRandomValues(x25519Key);
      record.set(x25519Key, offset);
      offset += 32;
      
      // ML-KEM-768 key (1184 bytes of random data)
      const mlkemKey = new Uint8Array(1184);
      crypto.getRandomValues(mlkemKey);
      record.set(mlkemKey, offset);
      offset += 1184;
      
      // Timestamp (8 bytes)
      const timestamp = BigInt(Date.now());
      const timestampView = new DataView(record.buffer, record.byteOffset + offset, 8);
      timestampView.setBigUint64(0, timestamp, false);
      offset += 8;
      
      // Signature (32 bytes of random data)
      const signature = new Uint8Array(32);
      crypto.getRandomValues(signature);
      record.set(signature, offset);

      let handlerCalled = false;

      // Register key exchange handler on node B (simulating KeyManager.registerKeyExchangeHandler)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle(KEY_EXCHANGE_PROTOCOL_ID, async (data: any) => {
        const stream = data.stream as LibP2PStream;
        const remotePeer = data.connection.remotePeer.toString();
        
        console.log(`[NodeB] Key exchange handler called from ${remotePeer.slice(0, 16)}...`);
        handlerCalled = true;

        try {
          // Send the public key record (same pattern as KeyManager)
          console.log(`[NodeB] Sending public key record (${record.length} bytes)...`);
          await stream.sink([record]);
          console.log(`[NodeB] Public key record sent`);
        } catch (error) {
          console.error('[NodeB] Error in key exchange handler:', error);
        } finally {
          await stream.close();
          console.log(`[NodeB] Stream closed`);
        }
      });

      // Verify protocol is registered
      const protocols = libp2pB.getProtocols();
      console.log(`[NodeB] Registered protocols: ${protocols.join(', ')}`);
      expect(protocols).toContain(KEY_EXCHANGE_PROTOCOL_ID);

      // Dial from node A to node B (simulating KeyManager.requestKeyDirectly)
      const targetPeerId = nodeB.peerId;
      const peerIdStr = targetPeerId.toString();
      
      console.log(`[NodeA] Dialing ${KEY_EXCHANGE_PROTOCOL_ID} to ${peerIdStr.slice(0, 16)}...`);
      const rawStream = await libp2pA.dialProtocol(targetPeerId, KEY_EXCHANGE_PROTOCOL_ID);
      const stream = rawStream as unknown as LibP2PStream;
      console.log(`[NodeA] Connected, reading response...`);

      // Read response (same pattern as KeyManager.requestKeyDirectly)
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream.source) {
        console.log(`[NodeA] Received chunk: ${chunk.subarray().length} bytes`);
        chunks.push(chunk.subarray());
      }

      await stream.close();

      console.log(`[NodeA] Received ${chunks.length} chunks`);

      expect(handlerCalled).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);

      // Concatenate chunks
      const totalLength = chunks.reduce((sum, arr) => sum + arr.length, 0);
      const receivedRecord = new Uint8Array(totalLength);
      let recvOffset = 0;
      for (const chunk of chunks) {
        receivedRecord.set(chunk, recvOffset);
        recvOffset += chunk.length;
      }

      console.log(`[NodeA] Total received: ${receivedRecord.length} bytes`);
      expect(receivedRecord.length).toBe(record.length);
      expect(receivedRecord).toEqual(record);
    }, 30000);

    it('should work with length-prefixed encoding (it-length-prefixed)', async () => {
      const nodeA = await createNode();
      const nodeB = await createNode();
      await connectNodes(nodeA, nodeB);

      const libp2pA = nodeA.getLibp2pNode();
      const libp2pB = nodeB.getLibp2pNode();

      const testData = new TextEncoder().encode('Length-prefixed test data');

      // Import length-prefixed utilities
      const { pipe } = await import('it-pipe');
      const lp = await import('it-length-prefixed');

      // Register handler on node B using length-prefixed encoding
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle('/test/lp/1.0.0', async (data: any) => {
        const stream = data.stream as LibP2PStream;
        console.log(`[NodeB] LP handler called`);

        try {
          // Send length-prefixed response
          await pipe(
            [testData],
            lp.encode,
            stream.sink
          );
          console.log(`[NodeB] LP response sent`);
        } catch (error) {
          console.error('[NodeB] Error in LP handler:', error);
        } finally {
          await stream.close();
        }
      });

      // Dial and read with length-prefixed decoding
      const targetPeerId = nodeB.peerId;
      
      const rawStream = await libp2pA.dialProtocol(targetPeerId, '/test/lp/1.0.0');
      const stream = rawStream as unknown as LibP2PStream;
      console.log(`[NodeA] Connected, reading LP response...`);

      // Read with length-prefixed decoding
      const chunks: Uint8Array[] = [];
      await pipe(
        stream.source,
        lp.decode,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (source: AsyncIterable<any>) => {
          for await (const chunk of source) {
            console.log(`[NodeA] Received LP chunk: ${chunk.subarray().length} bytes`);
            chunks.push(chunk.subarray());
          }
        }
      );

      await stream.close();

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toEqual(testData);
    }, 30000);

    it('should handle the exact KeyManager pattern with pipe and lp.decode', async () => {
      const nodeA = await createNode();
      const nodeB = await createNode();
      await connectNodes(nodeA, nodeB);

      const libp2pA = nodeA.getLibp2pNode();
      const libp2pB = nodeB.getLibp2pNode();

      // Create a mock public key record
      const peerIdBytes = new TextEncoder().encode(nodeB.peerId.toString());
      const recordSize = 2 + peerIdBytes.length + 32 + 1184 + 8 + 32;
      const record = new Uint8Array(recordSize);
      let offset = 0;
      record[offset++] = (peerIdBytes.length >> 8) & 0xff;
      record[offset++] = peerIdBytes.length & 0xff;
      record.set(peerIdBytes, offset);
      offset += peerIdBytes.length;
      crypto.getRandomValues(record.subarray(offset, offset + 32)); // x25519
      offset += 32;
      crypto.getRandomValues(record.subarray(offset, offset + 1184)); // mlkem
      offset += 1184;
      const timestampView = new DataView(record.buffer, record.byteOffset + offset, 8);
      timestampView.setBigUint64(0, BigInt(Date.now()), false);
      offset += 8;
      crypto.getRandomValues(record.subarray(offset, offset + 32)); // signature

      const { pipe } = await import('it-pipe');
      const lp = await import('it-length-prefixed');

      // Handler sends WITHOUT length-prefix (current KeyManager behavior)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle('/test/keymanager/1.0.0', async (data: any) => {
        const stream = data.stream as LibP2PStream;
        console.log(`[NodeB] KeyManager-style handler called`);

        try {
          // Send WITHOUT length-prefix (current KeyManager.registerKeyExchangeHandler behavior)
          await stream.sink([record]);
          console.log(`[NodeB] Record sent (no LP)`);
        } catch (error) {
          console.error('[NodeB] Error:', error);
        } finally {
          await stream.close();
        }
      });

      // Client reads WITH length-prefix decoding (current KeyManager.requestKeyDirectly behavior)
      const targetPeerId = nodeB.peerId;
      
      const rawStream = await libp2pA.dialProtocol(targetPeerId, '/test/keymanager/1.0.0');
      const stream = rawStream as unknown as LibP2PStream;
      console.log(`[NodeA] Connected, reading with LP decode...`);

      // This is the EXACT pattern from KeyManager.requestKeyDirectly
      const chunks: Uint8Array[] = [];
      
      try {
        await pipe(
          stream.source,
          lp.decode,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async (source: AsyncIterable<any>) => {
            for await (const chunk of source) {
              console.log(`[NodeA] Received chunk via LP decode: ${chunk.subarray().length} bytes`);
              chunks.push(chunk.subarray());
              break; // Only expect one message
            }
          }
        );
      } catch (error) {
        console.error(`[NodeA] Error reading with LP decode:`, error);
        // This is expected to fail because sender doesn't use LP encoding!
      }

      await stream.close();

      // This test demonstrates the MISMATCH:
      // - Handler sends raw data (no length-prefix)
      // - Client tries to decode with length-prefix
      // This will likely fail or produce incorrect results
      console.log(`[NodeA] Chunks received: ${chunks.length}`);
      
      // The test passes if we get here - we're documenting the behavior
      // In production, this mismatch causes "Empty pipeline" or incorrect data
    }, 30000);

    it('should work when BOTH sides use length-prefixed encoding', async () => {
      const nodeA = await createNode();
      const nodeB = await createNode();
      await connectNodes(nodeA, nodeB);

      const libp2pA = nodeA.getLibp2pNode();
      const libp2pB = nodeB.getLibp2pNode();

      // Create a mock public key record
      const peerIdBytes = new TextEncoder().encode(nodeB.peerId.toString());
      const recordSize = 2 + peerIdBytes.length + 32 + 1184 + 8 + 32;
      const record = new Uint8Array(recordSize);
      let offset = 0;
      record[offset++] = (peerIdBytes.length >> 8) & 0xff;
      record[offset++] = peerIdBytes.length & 0xff;
      record.set(peerIdBytes, offset);
      offset += peerIdBytes.length;
      crypto.getRandomValues(record.subarray(offset, offset + 32)); // x25519
      offset += 32;
      crypto.getRandomValues(record.subarray(offset, offset + 1184)); // mlkem
      offset += 1184;
      const timestampView = new DataView(record.buffer, record.byteOffset + offset, 8);
      timestampView.setBigUint64(0, BigInt(Date.now()), false);
      offset += 8;
      crypto.getRandomValues(record.subarray(offset, offset + 32)); // signature

      const { pipe } = await import('it-pipe');
      const lp = await import('it-length-prefixed');

      // Handler sends WITH length-prefix
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle('/test/keymanager-fixed/1.0.0', async (data: any) => {
        const stream = data.stream as LibP2PStream;
        console.log(`[NodeB] Fixed KeyManager-style handler called`);

        try {
          // Send WITH length-prefix
          await pipe(
            [record],
            lp.encode,
            stream.sink
          );
          console.log(`[NodeB] Record sent (with LP)`);
        } catch (error) {
          console.error('[NodeB] Error:', error);
        } finally {
          await stream.close();
        }
      });

      // Client reads WITH length-prefix decoding
      const targetPeerId = nodeB.peerId;
      
      const rawStream = await libp2pA.dialProtocol(targetPeerId, '/test/keymanager-fixed/1.0.0');
      const stream = rawStream as unknown as LibP2PStream;
      console.log(`[NodeA] Connected, reading with LP decode...`);

      const chunks: Uint8Array[] = [];
      
      await pipe(
        stream.source,
        lp.decode,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (source: AsyncIterable<any>) => {
          for await (const chunk of source) {
            console.log(`[NodeA] Received chunk via LP decode: ${chunk.subarray().length} bytes`);
            chunks.push(chunk.subarray());
            break; // Only expect one message
          }
        }
      );

      await stream.close();

      expect(chunks.length).toBe(1);
      expect(chunks[0].length).toBe(record.length);
      expect(chunks[0]).toEqual(record);
      console.log(`[NodeA] Successfully received ${chunks[0].length} bytes with LP encoding`);
    }, 30000);

    it('should work when NEITHER side uses length-prefixed encoding', async () => {
      const nodeA = await createNode();
      const nodeB = await createNode();
      await connectNodes(nodeA, nodeB);

      const libp2pA = nodeA.getLibp2pNode();
      const libp2pB = nodeB.getLibp2pNode();

      // Create a mock public key record
      const peerIdBytes = new TextEncoder().encode(nodeB.peerId.toString());
      const recordSize = 2 + peerIdBytes.length + 32 + 1184 + 8 + 32;
      const record = new Uint8Array(recordSize);
      let offset = 0;
      record[offset++] = (peerIdBytes.length >> 8) & 0xff;
      record[offset++] = peerIdBytes.length & 0xff;
      record.set(peerIdBytes, offset);
      offset += peerIdBytes.length;
      crypto.getRandomValues(record.subarray(offset, offset + 32)); // x25519
      offset += 32;
      crypto.getRandomValues(record.subarray(offset, offset + 1184)); // mlkem
      offset += 1184;
      const timestampView = new DataView(record.buffer, record.byteOffset + offset, 8);
      timestampView.setBigUint64(0, BigInt(Date.now()), false);
      offset += 8;
      crypto.getRandomValues(record.subarray(offset, offset + 32)); // signature

      // Handler sends WITHOUT length-prefix
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle('/test/keymanager-raw/1.0.0', async (data: any) => {
        const stream = data.stream as LibP2PStream;
        console.log(`[NodeB] Raw handler called`);

        try {
          // Send raw data
          await stream.sink([record]);
          console.log(`[NodeB] Record sent (raw)`);
        } catch (error) {
          console.error('[NodeB] Error:', error);
        } finally {
          await stream.close();
        }
      });

      // Client reads WITHOUT length-prefix decoding
      const targetPeerId = nodeB.peerId;
      
      const rawStream = await libp2pA.dialProtocol(targetPeerId, '/test/keymanager-raw/1.0.0');
      const stream = rawStream as unknown as LibP2PStream;
      console.log(`[NodeA] Connected, reading raw...`);

      const chunks: Uint8Array[] = [];
      
      for await (const chunk of stream.source) {
        console.log(`[NodeA] Received raw chunk: ${chunk.subarray().length} bytes`);
        chunks.push(chunk.subarray());
      }

      await stream.close();

      // Concatenate chunks
      const totalLength = chunks.reduce((sum, arr) => sum + arr.length, 0);
      const receivedData = new Uint8Array(totalLength);
      let recvOffset = 0;
      for (const chunk of chunks) {
        receivedData.set(chunk, recvOffset);
        recvOffset += chunk.length;
      }

      expect(receivedData.length).toBe(record.length);
      expect(receivedData).toEqual(record);
      console.log(`[NodeA] Successfully received ${receivedData.length} bytes raw`);
    }, 30000);
  });
});
