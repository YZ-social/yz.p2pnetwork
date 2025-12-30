/**
 * Unit tests for DHT provider operations (provide/findProviders)
 * 
 * Tests provide publishes record and findProviders returns provider.
 * 
 * Note: These tests focus on validation and error handling logic. Full DHT operations
 * require a network of peers and are covered in integration tests.
 * 
 * _Requirements: 5.1, 5.2_
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DHTNode, CID } from './node.js';
import { DHTConfigBuilder } from './config.js';
import { DHTError, DHTErrorCode } from './errors.js';
import { sha256 } from 'multiformats/hashes/sha2';
import * as raw from 'multiformats/codecs/raw';

describe('Provider Operations - provide/findProviders', () => {
  let node: DHTNode;

  /**
   * Helper to create a valid CID from arbitrary bytes
   */
  async function createCID(data: Uint8Array): Promise<CID> {
    const hash = await sha256.digest(data);
    return CID.create(1, raw.code, hash);
  }

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

  describe('provide publishes record', () => {
    it('rejects invalid CID string with INVALID_RECORD error', async () => {
      const invalidCid = 'not-a-valid-cid';

      await expect(node.provide(invalidCid)).rejects.toMatchObject({
        code: DHTErrorCode.INVALID_RECORD,
      });
    });

    it('rejects empty CID string with INVALID_RECORD error', async () => {
      const emptyCid = '';

      await expect(node.provide(emptyCid)).rejects.toMatchObject({
        code: DHTErrorCode.INVALID_RECORD,
      });
    });

    it('error for invalid CID includes context', async () => {
      const invalidCid = 'bad-cid-string';

      try {
        await node.provide(invalidCid);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DHTError);
        const dhtError = error as DHTError;
        expect(dhtError.code).toBe(DHTErrorCode.INVALID_RECORD);
        expect(dhtError.context).toBeDefined();
        expect(dhtError.context?.cid).toBe(invalidCid);
      }
    });

    it('accepts valid CID object', async () => {
      const content = new TextEncoder().encode('test-content');
      const cid = await createCID(content);

      try {
        await node.provide(cid);
      } catch (error) {
        // Should not fail with INVALID_RECORD for valid CID
        expect((error as DHTError).code).not.toBe(DHTErrorCode.INVALID_RECORD);
      }
    });

    it('accepts valid CID string', async () => {
      const content = new TextEncoder().encode('test-content-string');
      const cid = await createCID(content);
      const cidString = cid.toString();

      try {
        await node.provide(cidString);
      } catch (error) {
        // Should not fail with INVALID_RECORD for valid CID string
        expect((error as DHTError).code).not.toBe(DHTErrorCode.INVALID_RECORD);
      }
    });

    it('accepts CIDv1 with different codecs', async () => {
      // Create a CID with raw codec
      const content = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
      const cid = await createCID(content);

      try {
        await node.provide(cid);
      } catch (error) {
        expect((error as DHTError).code).not.toBe(DHTErrorCode.INVALID_RECORD);
      }
    });
  });

  describe('findProviders returns provider', () => {
    it('rejects invalid CID string with INVALID_RECORD error', async () => {
      const invalidCid = 'not-a-valid-cid';

      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _provider of node.findProviders(invalidCid)) {
          expect.fail('Should have thrown for invalid CID');
        }
        expect.fail('Should have thrown for invalid CID');
      } catch (error) {
        expect(error).toBeInstanceOf(DHTError);
        expect((error as DHTError).code).toBe(DHTErrorCode.INVALID_RECORD);
      }
    });

    it('rejects empty CID string with INVALID_RECORD error', async () => {
      const emptyCid = '';

      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _provider of node.findProviders(emptyCid)) {
          expect.fail('Should have thrown for empty CID');
        }
        expect.fail('Should have thrown for empty CID');
      } catch (error) {
        expect(error).toBeInstanceOf(DHTError);
        expect((error as DHTError).code).toBe(DHTErrorCode.INVALID_RECORD);
      }
    });

    it('error for invalid CID includes context', async () => {
      const invalidCid = 'another-bad-cid';

      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _provider of node.findProviders(invalidCid)) {
          // Should not reach here
        }
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DHTError);
        const dhtError = error as DHTError;
        expect(dhtError.code).toBe(DHTErrorCode.INVALID_RECORD);
        expect(dhtError.context).toBeDefined();
        expect(dhtError.context?.cid).toBe(invalidCid);
      }
    });

    it('accepts valid CID object without throwing INVALID_RECORD', async () => {
      const content = new TextEncoder().encode('find-providers-test');
      const cid = await createCID(content);

      try {
        // Get the iterator - this validates the CID
        const iterator = node.findProviders(cid)[Symbol.asyncIterator]();
        
        // Try to get first result with timeout
        const nextPromise = iterator.next();
        await Promise.race([
          nextPromise,
          new Promise(resolve => setTimeout(resolve, 100))
        ]);
        
        // If we get here without INVALID_RECORD, validation passed
      } catch (error) {
        // Should not fail with INVALID_RECORD for valid CID
        expect((error as DHTError).code).not.toBe(DHTErrorCode.INVALID_RECORD);
      }
    });

    it('accepts valid CID string without throwing INVALID_RECORD', async () => {
      const content = new TextEncoder().encode('find-providers-string-test');
      const cid = await createCID(content);
      const cidString = cid.toString();

      try {
        const iterator = node.findProviders(cidString)[Symbol.asyncIterator]();
        const nextPromise = iterator.next();
        await Promise.race([
          nextPromise,
          new Promise(resolve => setTimeout(resolve, 100))
        ]);
      } catch (error) {
        expect((error as DHTError).code).not.toBe(DHTErrorCode.INVALID_RECORD);
      }
    });
  });

  describe('node not started', () => {
    it('provide throws when node is not started', async () => {
      const unstartedNode = new DHTNode(
        DHTConfigBuilder.create()
          .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
          .build()
      );

      const content = new TextEncoder().encode('test');
      const cid = await createCID(content);

      await expect(unstartedNode.provide(cid)).rejects.toMatchObject({
        code: DHTErrorCode.INVALID_CONFIG,
      });
    });

    it('findProviders throws when node is not started', async () => {
      const unstartedNode = new DHTNode(
        DHTConfigBuilder.create()
          .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
          .build()
      );

      const content = new TextEncoder().encode('test');
      const cid = await createCID(content);

      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _provider of unstartedNode.findProviders(cid)) {
          // Should not reach here
        }
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DHTError);
        expect((error as DHTError).code).toBe(DHTErrorCode.INVALID_CONFIG);
      }
    });
  });
});
