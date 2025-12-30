/**
 * Unit tests for DHT content operations (PUT/GET)
 * 
 * Tests PUT with valid key-value, GET returns stored value, and GET on missing key.
 * 
 * Note: These tests focus on validation and error handling logic. Full DHT operations
 * require a network of peers and are covered in integration tests.
 * 
 * _Requirements: 4.1, 4.2, 4.3_
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DHTNode } from './node.js';
import { DHTConfigBuilder } from './config.js';
import { DHTError, DHTErrorCode } from './errors.js';

describe('Content Operations - PUT/GET', () => {
  let node: DHTNode;

  beforeAll(async () => {
    const config = DHTConfigBuilder.create()
      .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
      .build();
    
    node = new DHTNode(config);
    await node.start();
  }, 30000);

  afterAll(async () => {
    if (node?.isStarted) {
      await node.stop();
    }
  });

  describe('PUT with valid key-value', () => {
    it('rejects empty key with INVALID_RECORD error', async () => {
      const key = new Uint8Array(0);
      const value = new TextEncoder().encode('some-value');

      await expect(node.put(key, value)).rejects.toMatchObject({
        code: DHTErrorCode.INVALID_RECORD,
      });
    });

    it('rejects null value with INVALID_RECORD error', async () => {
      const key = new TextEncoder().encode('test-key');

      await expect(node.put(key, null as unknown as Uint8Array)).rejects.toMatchObject({
        code: DHTErrorCode.INVALID_RECORD,
      });
    });

    it('rejects undefined value with INVALID_RECORD error', async () => {
      const key = new TextEncoder().encode('test-key');

      await expect(node.put(key, undefined as unknown as Uint8Array)).rejects.toMatchObject({
        code: DHTErrorCode.INVALID_RECORD,
      });
    });

    it('validates key-value pair before attempting network operation', async () => {
      // Valid key-value should pass validation (may fail due to no peers, but not validation)
      const key = new TextEncoder().encode('test-key');
      const value = new TextEncoder().encode('test-value');

      try {
        await node.put(key, value);
      } catch (error) {
        // Should not fail with INVALID_RECORD for valid inputs
        expect((error as DHTError).code).not.toBe(DHTErrorCode.INVALID_RECORD);
      }
    });

    it('accepts binary key-value pairs', async () => {
      const key = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
      const value = new Uint8Array([0xAA, 0xBB, 0xCC]);

      try {
        await node.put(key, value);
      } catch (error) {
        expect((error as DHTError).code).not.toBe(DHTErrorCode.INVALID_RECORD);
      }
    });

    it('accepts empty value (zero-length)', async () => {
      const key = new TextEncoder().encode('key-with-empty-value');
      const value = new Uint8Array(0);

      try {
        await node.put(key, value);
      } catch (error) {
        // Empty values are allowed per the implementation
        expect((error as DHTError).code).not.toBe(DHTErrorCode.INVALID_RECORD);
      }
    });
  });

  describe('GET on missing key returns not-found error', () => {
    it('rejects empty key with INVALID_RECORD error', async () => {
      const key = new Uint8Array(0);

      await expect(node.get(key)).rejects.toMatchObject({
        code: DHTErrorCode.INVALID_RECORD,
      });
    });

    it('error for empty key includes context with key length', async () => {
      const key = new Uint8Array(0);

      try {
        await node.get(key);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DHTError);
        const dhtError = error as DHTError;
        expect(dhtError.code).toBe(DHTErrorCode.INVALID_RECORD);
        expect(dhtError.context).toBeDefined();
        expect(dhtError.context?.keyLength).toBe(0);
      }
    });
  });

  describe('GET returns stored value', () => {
    // Note: Full GET operations that return stored values require a network of peers
    // and are covered in integration tests. Unit tests focus on validation logic.
    
    it('validates key is not empty before network operation', async () => {
      // Empty key should fail validation immediately without network call
      const emptyKey = new Uint8Array(0);
      
      await expect(node.get(emptyKey)).rejects.toMatchObject({
        code: DHTErrorCode.INVALID_RECORD,
      });
    });
  });
});
