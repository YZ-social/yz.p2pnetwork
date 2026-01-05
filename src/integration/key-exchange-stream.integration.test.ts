/**
 * Integration tests for Key Exchange Stream Protocol
 *
 * Tests the raw libp2p stream communication for the key exchange protocol:
 * - Protocol handler registration
 * - Stream dialing and connection
 * - Data writing and reading using yamux stream interface
 *
 * This test isolates the stream communication layer to verify
 * the yamux stream interface works correctly in libp2p 3.x.
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
        const stream = data.stream || data;
        console.log(`[Test] Received connection`);
        await stream.close();
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

      // In libp2p 3.x with yamux, the handler receives { stream, connection }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle('/test/dial/1.0.0', async (streamData: any) => {
        console.log(`[NodeB] Handler called!`);
        const stream = streamData.stream || streamData;
        handlerCalled = true;
        await stream.close();
      });

      // Now connect the nodes
      await connectNodes(nodeA, nodeB);

      // Dial from node A to node B
      const targetPeerId = nodeB.peerId;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await libp2pA.dialProtocol(targetPeerId, '/test/dial/1.0.0') as any;
      await stream.close();

      // Wait a bit for handler to be called
      await delay(500);

      expect(handlerCalled).toBe(true);
    }, 30000);

    it('should send and receive data through a stream using yamux interface', async () => {
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

        try {
          // In yamux, iterate directly over the stream
          const chunks: Uint8Array[] = [];
          for await (const chunk of stream) {
            const data = chunk.subarray ? chunk.subarray() : chunk;
            console.log(`[NodeB] Received chunk: ${data.length} bytes`);
            chunks.push(data);
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
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await libp2pA.dialProtocol(targetPeerId, '/test/data/1.0.0') as any;
      
      // Use yamux sendData with Uint8ArrayList
      const { Uint8ArrayList } = await import('uint8arraylist');
      const dataList = new Uint8ArrayList(testData);
      
      const proto = Object.getPrototypeOf(stream);
      if (proto.sendData) {
        console.log(`[NodeA] Sending via sendData...`);
        await stream.sendData(dataList);
        await stream.sendCloseWrite();
      }
      
      await stream.close();

      // Wait for data to be received
      await delay(500);

      expect(receivedData).not.toBeNull();
      expect(receivedData!.length).toBe(testData.length);
    }, 30000);

    it('should send response back through the stream using yamux interface', async () => {
      const nodeA = await createNode();
      const nodeB = await createNode();
      await connectNodes(nodeA, nodeB);

      const libp2pA = nodeA.getLibp2pNode();
      const libp2pB = nodeB.getLibp2pNode();

      const responseData = new TextEncoder().encode('Response from Node B!');

      // Register handler on node B that sends a response using yamux interface
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle('/test/response/1.0.0', async (data: any) => {
        const stream = data.stream || data;
        console.log(`[NodeB] Handler called`);

        try {
          // Send response using yamux interface
          const { Uint8ArrayList } = await import('uint8arraylist');
          const dataList = new Uint8ArrayList(responseData);
          
          const proto = Object.getPrototypeOf(stream);
          if (proto.sendData) {
            await stream.sendData(dataList);
            await stream.sendCloseWrite();
          }
          console.log(`[NodeB] Response sent`);
        } catch (error) {
          console.error('[NodeB] Error sending response:', error);
        } finally {
          await stream.close();
        }
      });

      // Dial from node A to node B and read response
      const targetPeerId = nodeB.peerId;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await libp2pA.dialProtocol(targetPeerId, '/test/response/1.0.0') as any;
      
      console.log(`[NodeA] Connected, reading response...`);
      
      // Read response by iterating directly over the yamux stream
      // Use a timeout to avoid hanging if the stream doesn't close properly
      const chunks: Uint8Array[] = [];
      const readTimeout = 5000;
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Read timeout')), readTimeout);
      });
      
      const readPromise = (async () => {
        for await (const chunk of stream) {
          const data = chunk.subarray ? chunk.subarray() : chunk;
          console.log(`[NodeA] Received chunk: ${data.length} bytes`);
          chunks.push(data);
          // For this test, we expect only one message, so break after receiving
          break;
        }
      })();
      
      await Promise.race([readPromise, timeoutPromise]);

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
    it('should simulate key exchange protocol with actual protocol ID using yamux', async () => {
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

      // Register key exchange handler on node B using yamux interface
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle(KEY_EXCHANGE_PROTOCOL_ID, async (data: any) => {
        const stream = data.stream || data;
        const remotePeer = data?.connection?.remotePeer?.toString() || 'unknown';
        
        console.log(`[NodeB] Key exchange handler called from ${remotePeer.slice(0, 16)}...`);
        handlerCalled = true;

        try {
          // Send the public key record using yamux interface
          const { Uint8ArrayList } = await import('uint8arraylist');
          const dataList = new Uint8ArrayList(record);
          
          const proto = Object.getPrototypeOf(stream);
          if (proto.sendData) {
            await stream.sendData(dataList);
            await stream.sendCloseWrite();
          }
          console.log(`[NodeB] Public key record sent (${record.length} bytes)`);
        } catch (error) {
          console.error('[NodeB] Error in key exchange handler:', error);
        } finally {
          await stream.close();
        }
      });

      // Verify protocol is registered
      const protocols = libp2pB.getProtocols();
      expect(protocols).toContain(KEY_EXCHANGE_PROTOCOL_ID);

      // Dial from node A to node B
      const targetPeerId = nodeB.peerId;
      const peerIdStr = targetPeerId.toString();
      
      console.log(`[NodeA] Dialing ${KEY_EXCHANGE_PROTOCOL_ID} to ${peerIdStr.slice(0, 16)}...`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await libp2pA.dialProtocol(targetPeerId, KEY_EXCHANGE_PROTOCOL_ID) as any;
      console.log(`[NodeA] Connected, reading response...`);

      // Read response by iterating directly over the yamux stream
      // Use timeout and break after first message (key exchange is single message)
      const chunks: Uint8Array[] = [];
      const readTimeout = 5000;
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Read timeout')), readTimeout);
      });
      
      const readPromise = (async () => {
        for await (const chunk of stream) {
          const data = chunk.subarray ? chunk.subarray() : chunk;
          console.log(`[NodeA] Received chunk: ${data.length} bytes`);
          chunks.push(data);
          // Key exchange sends one message, break after receiving
          break;
        }
      })();
      
      await Promise.race([readPromise, timeoutPromise]);

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

    it('should work with raw data transfer (no length-prefix) using yamux', async () => {
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

      // Handler sends raw data using yamux interface
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle('/test/keymanager-raw/1.0.0', async (data: any) => {
        const stream = data.stream || data;
        console.log(`[NodeB] Raw handler called`);

        try {
          // Send raw data using yamux interface
          const { Uint8ArrayList } = await import('uint8arraylist');
          const dataList = new Uint8ArrayList(record);
          
          const proto = Object.getPrototypeOf(stream);
          if (proto.sendData) {
            await stream.sendData(dataList);
            await stream.sendCloseWrite();
          }
          console.log(`[NodeB] Record sent (raw)`);
        } catch (error) {
          console.error('[NodeB] Error:', error);
        } finally {
          await stream.close();
        }
      });

      // Client reads raw data by iterating directly over the yamux stream
      const targetPeerId = nodeB.peerId;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await libp2pA.dialProtocol(targetPeerId, '/test/keymanager-raw/1.0.0') as any;
      console.log(`[NodeA] Connected, reading raw...`);

      const chunks: Uint8Array[] = [];
      const readTimeout = 5000;
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Read timeout')), readTimeout);
      });
      
      const readPromise = (async () => {
        for await (const chunk of stream) {
          const data = chunk.subarray ? chunk.subarray() : chunk;
          console.log(`[NodeA] Received raw chunk: ${data.length} bytes`);
          chunks.push(data);
          // Single message expected, break after receiving
          break;
        }
      })();
      
      await Promise.race([readPromise, timeoutPromise]);

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
