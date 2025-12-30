/**
 * Error codes for DHT operations organized by category.
 */
export var DHTErrorCode;
(function (DHTErrorCode) {
    // Initialization errors
    DHTErrorCode["INVALID_CONFIG"] = "INVALID_CONFIG";
    DHTErrorCode["KEY_GENERATION_FAILED"] = "KEY_GENERATION_FAILED";
    // Network errors
    DHTErrorCode["BOOTSTRAP_FAILED"] = "BOOTSTRAP_FAILED";
    DHTErrorCode["CONNECTION_FAILED"] = "CONNECTION_FAILED";
    DHTErrorCode["DIAL_FAILED"] = "DIAL_FAILED";
    DHTErrorCode["TIMEOUT"] = "TIMEOUT";
    // DHT operation errors
    DHTErrorCode["NOT_FOUND"] = "NOT_FOUND";
    DHTErrorCode["PUT_FAILED"] = "PUT_FAILED";
    DHTErrorCode["INVALID_RECORD"] = "INVALID_RECORD";
    // Provider errors
    DHTErrorCode["PROVIDE_FAILED"] = "PROVIDE_FAILED";
    DHTErrorCode["NO_PROVIDERS"] = "NO_PROVIDERS";
})(DHTErrorCode || (DHTErrorCode = {}));
/**
 * Custom error class for DHT operations with typed error codes and context.
 */
export class DHTError extends Error {
    code;
    cause;
    context;
    constructor(code, message, options) {
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
    toString() {
        let str = `${this.name} [${this.code}]: ${this.message}`;
        if (this.context) {
            str += ` | Context: ${JSON.stringify(this.context)}`;
        }
        return str;
    }
}
//# sourceMappingURL=errors.js.map