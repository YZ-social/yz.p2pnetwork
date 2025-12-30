/**
 * Unit tests for DHT configuration validation
 *
 * Tests invalid configurations return errors and default values are applied correctly.
 *
 * _Requirements: 1.4_
 */
import { describe, it, expect } from 'vitest';
import { DHTConfigBuilder, validateConfig, serializeConfig, ConfigValidationError, DEFAULT_CONFIG, } from './config.js';
describe('Configuration Validation - Invalid Configurations', () => {
    describe('listenAddresses validation', () => {
        it('throws when listenAddresses is missing', () => {
            const config = {};
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('listenAddresses is required');
        });
        it('throws when listenAddresses is empty array', () => {
            const config = { listenAddresses: [] };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('listenAddresses is required and must not be empty');
        });
        it('throws when listenAddresses contains empty string', () => {
            const config = { listenAddresses: [''] };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('listenAddresses must contain non-empty strings');
        });
        it('throws when listenAddresses contains whitespace-only string', () => {
            const config = { listenAddresses: ['   '] };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('listenAddresses must contain non-empty strings');
        });
    });
    describe('kBucketSize validation', () => {
        it('throws when kBucketSize is 0', () => {
            const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'], kBucketSize: 0 };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('kBucketSize must be an integer between 1 and 100');
        });
        it('throws when kBucketSize exceeds 100', () => {
            const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'], kBucketSize: 101 };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('kBucketSize must be an integer between 1 and 100');
        });
        it('throws when kBucketSize is not an integer', () => {
            const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'], kBucketSize: 10.5 };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('kBucketSize must be an integer between 1 and 100');
        });
    });
    describe('alpha validation', () => {
        it('throws when alpha is 0', () => {
            const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'], alpha: 0 };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('alpha must be an integer between 1 and 20');
        });
        it('throws when alpha exceeds 20', () => {
            const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'], alpha: 21 };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('alpha must be an integer between 1 and 20');
        });
    });
    describe('interval and expiration validation', () => {
        it('throws when refreshInterval is below 1000ms', () => {
            const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'], refreshInterval: 999 };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('refreshInterval must be an integer >= 1000ms');
        });
        it('throws when recordExpiration is below 1000ms', () => {
            const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'], recordExpiration: 500 };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('recordExpiration must be an integer >= 1000ms');
        });
        it('throws when providerExpiration is below 1000ms', () => {
            const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'], providerExpiration: 0 };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('providerExpiration must be an integer >= 1000ms');
        });
    });
    describe('connection limits validation', () => {
        it('throws when maxConnections is 0', () => {
            const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'], maxConnections: 0 };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('maxConnections must be a positive integer');
        });
        it('throws when minConnections is negative', () => {
            const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'], minConnections: -1 };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('minConnections must be a non-negative integer');
        });
        it('throws when minConnections exceeds maxConnections', () => {
            const config = {
                listenAddresses: ['/ip4/0.0.0.0/tcp/0'],
                minConnections: 50,
                maxConnections: 10
            };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('minConnections cannot exceed maxConnections');
        });
    });
    describe('circuitRelay validation', () => {
        it('throws when circuitRelay.reservationTTL is below 1000ms', () => {
            const config = {
                listenAddresses: ['/ip4/0.0.0.0/tcp/0'],
                circuitRelay: { enabled: true, reservationTTL: 500 }
            };
            expect(() => validateConfig(config)).toThrow(ConfigValidationError);
            expect(() => validateConfig(config)).toThrow('circuitRelay.reservationTTL must be an integer >= 1000ms');
        });
    });
    describe('DHTConfigBuilder validation', () => {
        it('throws when building without listenAddresses', () => {
            expect(() => DHTConfigBuilder.create().build()).toThrow(ConfigValidationError);
        });
        it('throws when building with invalid kBucketSize', () => {
            expect(() => DHTConfigBuilder.create()
                .withListenAddresses(['/ip4/0.0.0.0/tcp/0'])
                .withKBucketSize(0)
                .build()).toThrow(ConfigValidationError);
        });
    });
});
describe('Configuration Defaults', () => {
    it('applies default kBucketSize when not specified', () => {
        const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'] };
        const serialized = serializeConfig(config);
        expect(serialized.kBucketSize).toBe(DEFAULT_CONFIG.kBucketSize);
    });
    it('applies default alpha when not specified', () => {
        const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'] };
        const serialized = serializeConfig(config);
        expect(serialized.alpha).toBe(DEFAULT_CONFIG.alpha);
    });
    it('applies default refreshInterval when not specified', () => {
        const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'] };
        const serialized = serializeConfig(config);
        expect(serialized.refreshInterval).toBe(DEFAULT_CONFIG.refreshInterval);
    });
    it('applies default recordExpiration when not specified', () => {
        const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'] };
        const serialized = serializeConfig(config);
        expect(serialized.recordExpiration).toBe(DEFAULT_CONFIG.recordExpiration);
    });
    it('applies default providerExpiration when not specified', () => {
        const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'] };
        const serialized = serializeConfig(config);
        expect(serialized.providerExpiration).toBe(DEFAULT_CONFIG.providerExpiration);
    });
    it('applies default maxConnections when not specified', () => {
        const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'] };
        const serialized = serializeConfig(config);
        expect(serialized.maxConnections).toBe(DEFAULT_CONFIG.maxConnections);
    });
    it('applies default minConnections when not specified', () => {
        const config = { listenAddresses: ['/ip4/0.0.0.0/tcp/0'] };
        const serialized = serializeConfig(config);
        expect(serialized.minConnections).toBe(DEFAULT_CONFIG.minConnections);
    });
    it('preserves custom values when specified', () => {
        const config = {
            listenAddresses: ['/ip4/0.0.0.0/tcp/0'],
            kBucketSize: 10,
            alpha: 5,
            refreshInterval: 60000,
            maxConnections: 50,
        };
        const serialized = serializeConfig(config);
        expect(serialized.kBucketSize).toBe(10);
        expect(serialized.alpha).toBe(5);
        expect(serialized.refreshInterval).toBe(60000);
        expect(serialized.maxConnections).toBe(50);
    });
    it('DEFAULT_CONFIG has expected values', () => {
        expect(DEFAULT_CONFIG.kBucketSize).toBe(20);
        expect(DEFAULT_CONFIG.alpha).toBe(3);
        expect(DEFAULT_CONFIG.refreshInterval).toBe(3600000);
        expect(DEFAULT_CONFIG.recordExpiration).toBe(86400000);
        expect(DEFAULT_CONFIG.providerExpiration).toBe(86400000);
        expect(DEFAULT_CONFIG.maxConnections).toBe(100);
        expect(DEFAULT_CONFIG.minConnections).toBe(5);
        expect(DEFAULT_CONFIG.protocol).toBe('/ipfs/kad/1.0.0');
    });
});
//# sourceMappingURL=config.test.js.map