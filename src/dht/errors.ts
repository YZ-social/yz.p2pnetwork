/**
 * Error codes for DHT operations organized by category.
 */
export enum DHTErrorCode {
  // Initialization errors
  INVALID_CONFIG = 'INVALID_CONFIG',
  KEY_GENERATION_FAILED = 'KEY_GENERATION_FAILED',

  // Network errors
  BOOTSTRAP_FAILED = 'BOOTSTRAP_FAILED',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  DIAL_FAILED = 'DIAL_FAILED',
  TIMEOUT = 'TIMEOUT',

  // DHT operation errors
  NOT_FOUND = 'NOT_FOUND',
  PUT_FAILED = 'PUT_FAILED',
  INVALID_RECORD = 'INVALID_RECORD',

  // Provider errors
  PROVIDE_FAILED = 'PROVIDE_FAILED',
  NO_PROVIDERS = 'NO_PROVIDERS',
}

/**
 * Custom error class for DHT operations with typed error codes and context.
 */
export class DHTError extends Error {
  readonly code: DHTErrorCode;
  readonly cause?: Error;
  readonly context?: Record<string, unknown>;

  constructor(
    code: DHTErrorCode,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message);
    this.name = 'DHTError';
    this.code = code;
    this.cause = options?.cause;
    this.context = options?.context;

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DHTError);
    }
  }

  /**
   * Creates a string representation including code and context.
   */
  toString(): string {
    let str = `${this.name} [${this.code}]: ${this.message}`;
    if (this.context) {
      str += ` | Context: ${JSON.stringify(this.context)}`;
    }
    return str;
  }
}
