/**
 * Integration tests for Overlay Protocol Stream Communication
 *
 * Tests the raw libp2p stream communication for the overlay protocol:
 * - Protocol handler registration
 * - Stream dialing and connection
 * - Data writing and reading using yamux stream interface
 * - Request/Response flow simulation
 *
 * This test isolates the overlay stream communication layer to verify
 * the yamux stream interface works correctly for overlay messaging.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { DHTNode } from '../dht/node.js';
import { DHTConfigBuilder } from '../dht/config.js';
import { cleanupNodes } from '../test-utils/network.js';
import { OVERLAY_PROTOCOL_ID, MessageType, CRYPTO_CONSTANTS } from '../overlay/constants.js';
import { WireProtocol } from '../overlay/wire-protocol.js';
import { v4 as uuidv4 } from 'uuid';
import type { EncryptedPayload, HybridPublicKey } from '../overlay/types.js';

/**
 * Simple delay utility.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Overlay Protocol Stream Integration Tests', () => {
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

  /**
   * Concatenate multiple Uint8Arrays into one.
   */
  function concatenateArrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }

  /**
   * Create a mock encrypted payload for testing
   */
  function createMockEncryptedPayload(data: Uint8Array): EncryptedPayload {
    return {
      ephemeralX25519: new Uint8Array(CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE),
      mlkemCiphertext: new Uint8Array(CRYPTO_CONSTANTS.MLKEM768_CIPHERTEXT_SIZE),
      nonce: new Uint8Array(CRYPTO_CONSTANTS.AES_GCM_NONCE_SIZE),
      ciphertext: data,
      authTag: new Uint8Array(CRYPTO_CONSTANTS.AES_GCM_TAG_SIZE),
    };
  }

  /**
   * Create a mock hybrid public key for testing
   */
  function createMockPublicKey(): HybridPublicKey {
    return {
      x25519: new Uint8Array(CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE),
      mlkem768: new Uint8Array(CRYPTO_CONSTANTS.MLKEM768_PUBLIC_KEY_SIZE),
    };
  }


  // ==========================================================================
  // Basic Overlay Protocol Tests
  // ==========================================================================

  describe('Basic Overlay Protocol Communication', () => {
    it('should register overlay protocol handler on a node', async () => {
      const node = await createNode();
      const libp2p = node.getLibp2pNode();

      // Register overlay protocol handler
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2p.handle(OVERLAY_PROTOCOL_ID, async (data: any) => {
        const stream = data.stream || data;
        console.log(`[Test] Received overlay connection`);
        await stream.close();
      });

      // Verify protocol is registered
      const protocols = libp2p.getProtocols();
      expect(protocols).toContain(OVERLAY_PROTOCOL_ID);
    }, 30000);

    it('should dial overlay protocol between two connected nodes', async () => {
      const nodeA = await createNode();
      const nodeB = await createNode();

      const libp2pA = nodeA.getLibp2pNode();
      const libp2pB = nodeB.getLibp2pNode();

      let handlerCalled = false;

      // Register overlay handler on node B
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle(OVERLAY_PROTOCOL_ID, async (streamData: any) => {
        console.log(`[NodeB] Overlay handler called!`);
        const stream = streamData.stream || streamData;
        handlerCalled = true;
        await stream.close();
      });

      // Connect the nodes
      await connectNodes(nodeA, nodeB);

      // Dial overlay protocol from node A to node B
      const targetPeerId = nodeB.peerId;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await libp2pA.dialProtocol(targetPeerId, OVERLAY_PROTOCOL_ID) as any;
      await stream.close();

      // Wait for handler to be called
      await delay(500);

      expect(handlerCalled).toBe(true);
    }, 30000);

    it('should send overlay message and receive response using yamux interface', async () => {
      const nodeA = await createNode();
      const nodeB = await createNode();
      await connectNodes(nodeA, nodeB);

      const libp2pA = nodeA.getLibp2pNode();
      const libp2pB = nodeB.getLibp2pNode();

      const wireProtocol = new WireProtocol();
      
      // Create a mock request message
      const mockRequest = {
        type: MessageType.REQUEST as const,
        messageId: uuidv4(),
        originPeerId: nodeA.peerId.toString(),
        targetPeerId: nodeB.peerId.toString(),
        ttl: 10,
        timestamp: Date.now(),
        path: [],
        originPublicKey: createMockPublicKey(),
        encryptedPayload: createMockEncryptedPayload(new TextEncoder().encode('test payload')),
      };
      
      const requestData = wireProtocol.encodeRequest(mockRequest);
      let receivedRequest = false;
      let responseData: Uint8Array | null = null;

      // Register overlay handler on node B that reads request and sends response
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle(OVERLAY_PROTOCOL_ID, async (streamData: any) => {
        const stream = streamData.stream || streamData;
        console.log(`[NodeB] Overlay handler called`);

        try {
          // Read the incoming message with timeout and break
          const chunks: Uint8Array[] = [];
          const readTimeout = 5000;
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error('Read timeout')), readTimeout);
          });
          
          const readPromise = (async () => {
            for await (const chunk of stream) {
              if (chunk && typeof chunk.subarray === 'function') {
                chunks.push(chunk.subarray());
              } else if (chunk instanceof Uint8Array) {
                chunks.push(chunk);
              }
              // Overlay messages are single messages, break after receiving
              break;
            }
          })();
          
          try {
            await Promise.race([readPromise, timeoutPromise]);
          } catch (err) {
            if (chunks.length === 0) {
              console.warn('[NodeB] Read timeout with no data');
              return;
            }
          }
          
          if (chunks.length > 0) {
            const messageData = concatenateArrays(chunks);
            console.log(`[NodeB] Received ${messageData.length} bytes`);
            
            // Decode and verify it's a request
            const decoded = wireProtocol.decode(messageData);
            if (decoded.type === MessageType.REQUEST) {
              receivedRequest = true;
              console.log(`[NodeB] Decoded REQUEST message: ${decoded.messageId}`);
              
              // Create and send response
              const mockResponse = {
                type: MessageType.RESPONSE as const,
                messageId: decoded.messageId,
                originPeerId: decoded.originPeerId,
                targetPeerId: nodeB.peerId.toString(),
                path: [nodeB.peerId.toString()],
                encryptedPayload: createMockEncryptedPayload(new TextEncoder().encode('response payload')),
                success: true,
              };
              
              const responseBytes = wireProtocol.encodeResponse(mockResponse);
              
              // Send response using yamux interface
              const { Uint8ArrayList } = await import('uint8arraylist');
              const dataList = new Uint8ArrayList(responseBytes);
              
              const proto = Object.getPrototypeOf(stream);
              if (proto.sendData) {
                await stream.sendData(dataList);
                await stream.sendCloseWrite();
                console.log(`[NodeB] Response sent (${responseBytes.length} bytes)`);
              }
            }
          }
        } catch (error) {
          console.error('[NodeB] Error handling overlay message:', error);
        } finally {
          await stream.close();
        }
      });

      // Dial overlay protocol from node A to node B and send request
      const targetPeerId = nodeB.peerId;
      
      console.log(`[NodeA] Dialing overlay protocol to ${targetPeerId.toString().slice(0, 16)}...`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await libp2pA.dialProtocol(targetPeerId, OVERLAY_PROTOCOL_ID) as any;
      
      // Send request using yamux interface
      const { Uint8ArrayList } = await import('uint8arraylist');
      const dataList = new Uint8ArrayList(requestData);
      
      const proto = Object.getPrototypeOf(stream);
      if (proto.sendData) {
        console.log(`[NodeA] Sending request (${requestData.length} bytes)...`);
        await stream.sendData(dataList);
        await stream.sendCloseWrite();
      }
      
      // Read response with timeout and break
      const chunks: Uint8Array[] = [];
      const readTimeout = 5000;
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Read timeout')), readTimeout);
      });
      
      const readPromise = (async () => {
        for await (const chunk of stream) {
          if (chunk && typeof chunk.subarray === 'function') {
            chunks.push(chunk.subarray());
          } else if (chunk instanceof Uint8Array) {
            chunks.push(chunk);
          }
          // Overlay responses are single messages, break after receiving
          break;
        }
      })();
      
      try {
        await Promise.race([readPromise, timeoutPromise]);
      } catch {
        // Timeout is okay if we got data
      }
      
      await stream.close();

      if (chunks.length > 0) {
        responseData = concatenateArrays(chunks);
        console.log(`[NodeA] Received response (${responseData.length} bytes)`);
        
        // Decode and verify response
        const decoded = wireProtocol.decode(responseData);
        expect(decoded.type).toBe(MessageType.RESPONSE);
        console.log(`[NodeA] Decoded RESPONSE message: ${decoded.messageId}`);
      }

      expect(receivedRequest).toBe(true);
      expect(responseData).not.toBeNull();
    }, 30000);
  });


  // ==========================================================================
  // Simulated Overlay sendToNode Tests
  // ==========================================================================

  describe('Simulated sendToNode Flow', () => {
    it('should simulate the sendToNode flow with request and response', async () => {
      const nodeA = await createNode();
      const nodeB = await createNode();
      await connectNodes(nodeA, nodeB);

      const libp2pA = nodeA.getLibp2pNode();
      const libp2pB = nodeB.getLibp2pNode();

      const wireProtocol = new WireProtocol();
      
      // Create a mock request
      const mockRequest = {
        type: MessageType.REQUEST as const,
        messageId: uuidv4(),
        originPeerId: nodeA.peerId.toString(),
        targetPeerId: nodeB.peerId.toString(),
        ttl: 10,
        timestamp: Date.now(),
        path: [],
        originPublicKey: createMockPublicKey(),
        encryptedPayload: createMockEncryptedPayload(new TextEncoder().encode('Hello from Node A!')),
      };
      
      const requestData = wireProtocol.encodeRequest(mockRequest);
      let handlerCalled = false;

      // Register handler on node B (simulating overlay.registerProtocolHandler)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle(OVERLAY_PROTOCOL_ID, async (streamData: any) => {
        const stream = streamData.stream || streamData;
        
        try {
          // Read the incoming message - iterate directly over the yamux stream
          // Use a timeout to avoid hanging if the sender doesn't close the write side
          const chunks: Uint8Array[] = [];
          const readTimeout = 5000;
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error('Read timeout')), readTimeout);
          });
          
          const readPromise = (async () => {
            for await (const chunk of stream) {
              // Handle both Uint8ArrayList and Uint8Array
              if (chunk && typeof chunk.subarray === 'function') {
                chunks.push(chunk.subarray());
              } else if (chunk instanceof Uint8Array) {
                chunks.push(chunk);
              }
              // Overlay messages are single messages, break after receiving
              break;
            }
          })();
          
          try {
            await Promise.race([readPromise, timeoutPromise]);
          } catch (err) {
            if (chunks.length === 0) {
              console.warn('[NodeB] Overlay protocol handler: read timeout with no data');
              return;
            }
          }
          
          if (chunks.length === 0) {
            return;
          }
          
          const messageData = concatenateArrays(chunks);
          console.log(`[NodeB] Received message: ${messageData.length} bytes`);
          
          // Decode the message
          const decoded = wireProtocol.decode(messageData);
          console.log(`[NodeB] Decoded message type: ${decoded.type}`);
          
          if (decoded.type === MessageType.REQUEST) {
            handlerCalled = true;
            
            // Create response
            const response = {
              type: MessageType.RESPONSE as const,
              messageId: decoded.messageId,
              originPeerId: decoded.originPeerId,
              targetPeerId: nodeB.peerId.toString(),
              path: [nodeB.peerId.toString()],
              encryptedPayload: createMockEncryptedPayload(new TextEncoder().encode('Echo from Node B!')),
              success: true,
            };
            
            const responseBytes = wireProtocol.encodeResponse(response);
            
            // Send response using yamux interface
            const { Uint8ArrayList } = await import('uint8arraylist');
            const dataList = new Uint8ArrayList(responseBytes);
            
            const proto = Object.getPrototypeOf(stream);
            if (proto.sendData) {
              await stream.sendData(dataList);
              await stream.sendCloseWrite();
              console.log(`[NodeB] Response sent`);
            }
          }
        } catch (error) {
          console.error('[NodeB] Error handling overlay message:', error);
        } finally {
          await stream.close();
        }
      });

      // Simulate sendToNode from node A (like overlay.sendToNode)
      const { peerIdFromString } = await import('@libp2p/peer-id');
      const targetPeerId = peerIdFromString(nodeB.peerId.toString());

      console.log(`[NodeA] Dialing overlay protocol...`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawStream = await libp2pA.dialProtocol(targetPeerId, OVERLAY_PROTOCOL_ID);
      const stream = rawStream as any;
      
      try {
        // Send data using yamux interface
        const proto = Object.getPrototypeOf(stream);
        
        if (proto.sendData) {
          const { Uint8ArrayList } = await import('uint8arraylist');
          const dataList = new Uint8ArrayList(requestData);
          await stream.sendData(dataList);
          await stream.sendCloseWrite();
          console.log(`[NodeA] Request sent`);
        }

        // Read response with timeout and break
        const chunks: Uint8Array[] = [];
        const readTimeout = 5000;
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('Read timeout')), readTimeout);
        });
        
        const readPromise = (async () => {
          for await (const chunk of stream) {
            if (chunk && typeof chunk.subarray === 'function') {
              chunks.push(chunk.subarray());
            } else if (chunk instanceof Uint8Array) {
              chunks.push(chunk);
            }
            // Overlay responses are single messages, break after receiving
            break;
          }
        })();
        
        try {
          await Promise.race([readPromise, timeoutPromise]);
        } catch {
          // Timeout is okay - not all messages have responses
        }

        if (chunks.length > 0) {
          const responseData = concatenateArrays(chunks);
          console.log(`[NodeA] Received response: ${responseData.length} bytes`);
          
          const decoded = wireProtocol.decode(responseData);
          expect(decoded.type).toBe(MessageType.RESPONSE);
        }
      } finally {
        await stream.close();
      }

      expect(handlerCalled).toBe(true);
    }, 30000);

    it('should handle multiple sequential overlay requests', async () => {
      const nodeA = await createNode();
      const nodeB = await createNode();
      await connectNodes(nodeA, nodeB);

      const libp2pA = nodeA.getLibp2pNode();
      const libp2pB = nodeB.getLibp2pNode();

      const wireProtocol = new WireProtocol();
      let requestCount = 0;

      // Register handler on node B
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await libp2pB.handle(OVERLAY_PROTOCOL_ID, async (streamData: any) => {
        const stream = streamData.stream || streamData;
        
        try {
          const chunks: Uint8Array[] = [];
          const readTimeout = 5000;
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error('Read timeout')), readTimeout);
          });
          
          const readPromise = (async () => {
            for await (const chunk of stream) {
              if (chunk && typeof chunk.subarray === 'function') {
                chunks.push(chunk.subarray());
              } else if (chunk instanceof Uint8Array) {
                chunks.push(chunk);
              }
              break;
            }
          })();
          
          try {
            await Promise.race([readPromise, timeoutPromise]);
          } catch {
            if (chunks.length === 0) return;
          }
          
          if (chunks.length === 0) return;
          
          const messageData = concatenateArrays(chunks);
          const decoded = wireProtocol.decode(messageData);
          
          if (decoded.type === MessageType.REQUEST) {
            requestCount++;
            console.log(`[NodeB] Received request #${requestCount}`);
            
            const response = {
              type: MessageType.RESPONSE as const,
              messageId: decoded.messageId,
              originPeerId: decoded.originPeerId,
              targetPeerId: nodeB.peerId.toString(),
              path: [nodeB.peerId.toString()],
              encryptedPayload: createMockEncryptedPayload(new TextEncoder().encode(`Response #${requestCount}`)),
              success: true,
            };
            
            const responseBytes = wireProtocol.encodeResponse(response);
            const { Uint8ArrayList } = await import('uint8arraylist');
            const dataList = new Uint8ArrayList(responseBytes);
            
            const proto = Object.getPrototypeOf(stream);
            if (proto.sendData) {
              await stream.sendData(dataList);
              await stream.sendCloseWrite();
            }
          }
        } catch (error) {
          console.error('[NodeB] Error:', error);
        } finally {
          await stream.close();
        }
      });

      // Send multiple requests
      const { peerIdFromString } = await import('@libp2p/peer-id');
      const targetPeerId = peerIdFromString(nodeB.peerId.toString());

      for (let i = 0; i < 3; i++) {
        const mockRequest = {
          type: MessageType.REQUEST as const,
          messageId: uuidv4(),
          originPeerId: nodeA.peerId.toString(),
          targetPeerId: nodeB.peerId.toString(),
          ttl: 10,
          timestamp: Date.now(),
          path: [],
          originPublicKey: createMockPublicKey(),
          encryptedPayload: createMockEncryptedPayload(new TextEncoder().encode(`Request #${i + 1}`)),
        };
        
        const requestData = wireProtocol.encodeRequest(mockRequest);
        
        console.log(`[NodeA] Sending request #${i + 1}...`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stream = await libp2pA.dialProtocol(targetPeerId, OVERLAY_PROTOCOL_ID) as any;
        
        try {
          const { Uint8ArrayList } = await import('uint8arraylist');
          const dataList = new Uint8ArrayList(requestData);
          
          const proto = Object.getPrototypeOf(stream);
          if (proto.sendData) {
            await stream.sendData(dataList);
            await stream.sendCloseWrite();
          }

          // Read response
          const chunks: Uint8Array[] = [];
          const readTimeout = 5000;
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error('Read timeout')), readTimeout);
          });
          
          const readPromise = (async () => {
            for await (const chunk of stream) {
              if (chunk && typeof chunk.subarray === 'function') {
                chunks.push(chunk.subarray());
              } else if (chunk instanceof Uint8Array) {
                chunks.push(chunk);
              }
              break;
            }
          })();
          
          try {
            await Promise.race([readPromise, timeoutPromise]);
          } catch {
            // Timeout okay
          }

          if (chunks.length > 0) {
            const responseData = concatenateArrays(chunks);
            const decoded = wireProtocol.decode(responseData);
            expect(decoded.type).toBe(MessageType.RESPONSE);
            console.log(`[NodeA] Received response #${i + 1}`);
          }
        } finally {
          await stream.close();
        }
        
        // Small delay between requests
        await delay(100);
      }

      expect(requestCount).toBe(3);
    }, 60000);
  });
});
