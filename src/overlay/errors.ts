/**
 * Error codes for Overlay Network operations organized by category.
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */
export enum OverlayErrorCode {
  // Send errors (Requirement 8.1, 8.2)
  TIMEOUT = 'TIMEOUT',
  UNREACHABLE = 'UNREACHABLE',
  MESSAGE_TOO_LARGE = 'MESSAGE_TOO_LARGE',

  // Receive errors (Requirement 8.4)
  NO_HANDLER = 'NO_HANDLER',
  HANDLER_ERROR = 'HANDLER_ERROR',

  // Protocol errors (Requirement 8.5)
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  DUPLICATE = 'DUPLICATE',

  // Routing errors (Requirement 8.2)
  TTL_EXPIRED = 'TTL_EXPIRED',
  NO_ROUTE = 'NO_ROUTE',
  TARGET_NOT_FOUND = 'TARGET_NOT_FOUND',

  // Encryption errors (Requirement 8.6)
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  KEY_NOT_FOUND = 'KEY_NOT_FOUND',

  // Attestation errors
  ATTESTATION_FAILED = 'ATTESTATION_FAILED',
  ATTESTATION_REQUIRED = 'ATTESTATION_REQUIRED',
}

/**
 * Custom error class for Overlay Network operations with typed error codes and context.
 */
export class OverlayError extends Error {
  readonly code: OverlayErrorCode;
  readonly messageId?: string;
  readonly cause?: Error;
  readonly context?: Record<string, unknown>;

  constructor(
    code: OverlayErrorCode,
    message: string,
    options?: {
      messageId?: string;
      cause?: Error;
      context?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = 'OverlayError';
    this.code = code;
    this.messageId = options?.messageId;
    this.cause = options?.cause;
    this.context = options?.context;

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OverlayError);
    }
  }

  /**
   * Creates a string representation including code, messageId, and context.
   */
  toString(): string {
    let str = `${this.name} [${this.code}]: ${this.message}`;
    if (this.messageId) {
      str += ` | MessageId: ${this.messageId}`;
    }
    if (this.context) {
      str += ` | Context: ${JSON.stringify(this.context)}`;
    }
    return str;
  }
}
