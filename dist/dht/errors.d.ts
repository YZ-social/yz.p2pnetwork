/**
 * Error codes for DHT operations organized by category.
 */
export declare enum DHTErrorCode {
    INVALID_CONFIG = "INVALID_CONFIG",
    KEY_GENERATION_FAILED = "KEY_GENERATION_FAILED",
    BOOTSTRAP_FAILED = "BOOTSTRAP_FAILED",
    CONNECTION_FAILED = "CONNECTION_FAILED",
    DIAL_FAILED = "DIAL_FAILED",
    TIMEOUT = "TIMEOUT",
    NOT_FOUND = "NOT_FOUND",
    PUT_FAILED = "PUT_FAILED",
    INVALID_RECORD = "INVALID_RECORD",
    PROVIDE_FAILED = "PROVIDE_FAILED",
    NO_PROVIDERS = "NO_PROVIDERS"
}
/**
 * Custom error class for DHT operations with typed error codes and context.
 */
export declare class DHTError extends Error {
    readonly code: DHTErrorCode;
    readonly cause?: Error;
    readonly context?: Record<string, unknown>;
    constructor(code: DHTErrorCode, message: string, options?: {
        cause?: Error;
        context?: Record<string, unknown>;
    });
    /**
     * Creates a string representation including code and context.
     */
    toString(): string;
}
//# sourceMappingURL=errors.d.ts.map