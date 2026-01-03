/**
 * Overlay Network Facade
 *
 * Main facade providing request-response messaging between specific nodes with:
 * - Message deduplication to prevent flooding
 * - DHT-based routing for message delivery
 * - Hybrid post-quantum end-to-end encryption (X25519 + ML-KEM-768)
 *
 * Requirements: 1.1-1.6, 2.1-2.6, 3.1-3.5, 4.1-4.5, 5.1-5.5, 6.1-6.7, 7.1-7.8, 8.1-8.6, 9.1-9.10
 */

import { v4 as uuidv4 } from 'uuid';
import type { DHTNode } from '../dht/node.js';
import {
  MessageType,
  UnreachableReason,
  DEFAULT_OVERLAY_CONFIG,
  DEFAULT_ENCRYPTION_CONFIG,
  DEFAULT_ATTESTATION_CONFIG,
  OVERLAY_PROTOCOL_ID,
} from './constants.js';
import { OverlayError, OverlayErrorCode } from './errors.js';
import { HybridCrypto } from './crypto.js';
import { KeyManager, InMemoryKeyStorage, type KeyStorage } from './key-manager.js';
import { WireProtocol } from './wire-protocol.js';
import { DeduplicationCache } from './dedup-cache.js';
import { PendingRequestsManager } from './pending-requests.js';
import { MessageRouter } from './router.js';
import type {
  OverlayConfig,
  EncryptionConfig,
  SendOptions,
  MessageContext,
  MessageHandler,
  HybridPublicKey,
  HybridKeyPair,
  RequestMessage,
  ResponseMessage,
  DuplicateMessage,
  UnreachableMessage,
  OverlayMessage,
  AttestationVerifier,
  NodeAttestation,
} from './types.js';
import { NoOpAttestationVerifier } from './attestation.js';

/**
 * Resolved configuration with all defaults applied
 */
interface ResolvedOverlayConfig {
  maxMessageSize: number;
  defaultTTL: number;
  dedupeWindowMs: number;
  defaultRedundancy: number;
  responseTimeout: number;
  encryption: Required<EncryptionConfig>;
  attestation: {
    enabled: boolean;
    verifier?: AttestationVerifier;
    handlerCodeHash?: string;
  };
}


/**
 * OverlayNetwork - Main facade for overlay messaging
 *
 * Provides:
 * - sendMessage(): Send encrypted messages to target nodes
 * - onMessage(): Register handler for incoming messages
 * - offMessage(): Remove message handler
 * - start()/stop(): Lifecycle management
 *
 * Requirements: 7.1-7.8
 */
export class OverlayNetwork {
  private readonly _dht: DHTNode;
  private readonly config: ResolvedOverlayConfig;
  private readonly crypto: HybridCrypto;
  private readonly keyManager: KeyManager;
  private readonly wireProtocol: WireProtocol;
  private readonly dedupCache: DeduplicationCache;
  private readonly pendingRequests: PendingRequestsManager;
  private readonly router: MessageRouter;

  private messageHandler: MessageHandler | null = null;
  private started = false;
  private keyPublishTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a new OverlayNetwork instance.
   *
   * Requirements 7.1-7.8: Configuration with sensible defaults
   *
   * @param dht - The DHT node to use for routing and key storage
   * @param config - Optional overlay configuration
   * @param keyStorage - Optional key storage implementation
   */
  constructor(
    dht: DHTNode,
    config?: OverlayConfig,
    keyStorage?: KeyStorage
  ) {
    this._dht = dht;
    this.config = this.resolveConfig(config);

    // Initialize components
    this.crypto = new HybridCrypto();
    this.keyManager = new KeyManager({
      storage: keyStorage ?? new InMemoryKeyStorage(),
      cacheTTL: this.config.encryption.keyCacheTTL,
      crypto: this.crypto,
    });
    this.wireProtocol = new WireProtocol();
    this.dedupCache = new DeduplicationCache({
      ttlMs: this.config.dedupeWindowMs,
      cleanupIntervalMs: Math.floor(this.config.dedupeWindowMs / 2),
    });
    this.pendingRequests = new PendingRequestsManager({
      defaultTimeout: this.config.responseTimeout,
      checkIntervalMs: 1000,
    });
    this.router = new MessageRouter(dht, {
      defaultRedundancy: this.config.defaultRedundancy,
    });
  }

  /**
   * Get the underlying DHT node
   */
  get dht(): DHTNode {
    return this._dht;
  }

  /**
   * Get this node's peer ID
   */
  get peerId(): string {
    return this._dht.peerId.toString();
  }

  /**
   * Check if the overlay network is started
   */
  get isStarted(): boolean {
    return this.started;
  }

  /**
   * Get the resolved configuration
   */
  getConfig(): ResolvedOverlayConfig {
    return { ...this.config };
  }

  /**
   * Get this node's public keys for encryption
   *
   * @throws OverlayError if not started
   */
  getPublicKeys(): HybridPublicKey {
    this.ensureStarted();
    return this.keyManager.getPublicKey();
  }

  /**
   * Start the overlay network.
   * Initializes encryption keys and registers protocol handler.
   *
   * Requirements 7.1-7.8: Lifecycle management
   *
   * @param existingKeys - Optional existing key pair to use
   */
  async start(existingKeys?: HybridKeyPair): Promise<void> {
    if (this.started) {
      return; // Idempotent
    }

    // Initialize key manager
    await this.keyManager.initialize(existingKeys);
    this.keyManager.setDHT(this._dht, this.peerId);

    // Publish public key to DHT
    if (this.config.encryption.enabled) {
      await this.keyManager.publishPublicKey();

      // Set up periodic key publishing
      if (this.config.encryption.keyPublishInterval > 0) {
        this.keyPublishTimer = setInterval(
          () => this.keyManager.publishPublicKey().catch(() => {}),
          this.config.encryption.keyPublishInterval
        );
      }

      // Register key exchange handler for direct key requests
      await this.keyManager.registerKeyExchangeHandler();
    }

    // Register libp2p protocol handler
    this.registerProtocolHandler();

    this.started = true;
  }

  /**
   * Stop the overlay network.
   * Cleans up resources and unregisters protocol handler.
   *
   * Requirements 7.1-7.8: Lifecycle management
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return; // Idempotent
    }

    // Stop key publish timer
    if (this.keyPublishTimer) {
      clearInterval(this.keyPublishTimer);
      this.keyPublishTimer = null;
    }

    // Unregister protocol handler
    this.unregisterProtocolHandler();

    // Unregister key exchange handler
    this.keyManager.unregisterKeyExchangeHandler();

    // Clean up components
    this.dedupCache.destroy();
    this.pendingRequests.destroy();

    this.started = false;
  }


  /**
   * Send a message to a target node and wait for a response.
   *
   * Requirements 1.1, 1.3, 1.4, 9.1, 9.6: Message sending with encryption
   *
   * @param targetPeerId - The peer ID of the target node
   * @param payload - The message payload to send
   * @param options - Optional send options
   * @returns The response payload from the target
   * @throws OverlayError on timeout, unreachable, or other errors
   */
  async sendMessage(
    targetPeerId: string,
    payload: Uint8Array,
    options?: SendOptions
  ): Promise<Uint8Array> {
    this.ensureStarted();

    // Requirement 8.3: Validate message size
    if (payload.length > this.config.maxMessageSize) {
      throw new OverlayError(
        OverlayErrorCode.MESSAGE_TOO_LARGE,
        `Payload size ${payload.length} exceeds maximum ${this.config.maxMessageSize}`,
        { context: { payloadSize: payload.length, maxSize: this.config.maxMessageSize } }
      );
    }

    const messageId = uuidv4();
    const timeout = options?.timeout ?? this.config.responseTimeout;
    const redundancy = options?.redundancy ?? this.config.defaultRedundancy;
    const ttl = options?.ttl ?? this.config.defaultTTL;

    // Requirement 9.1, 9.6: Lookup target's public key and encrypt payload
    let targetPublicKey: HybridPublicKey;
    try {
      targetPublicKey = await this.keyManager.lookupPublicKey(targetPeerId);
    } catch (error) {
      throw new OverlayError(
        OverlayErrorCode.KEY_NOT_FOUND,
        `Failed to lookup public key for target ${targetPeerId}`,
        {
          messageId,
          cause: error instanceof Error ? error : undefined,
          context: { targetPeerId },
        }
      );
    }

    // Encrypt the payload
    const encryptedPayload = await this.crypto.encrypt(payload, targetPublicKey);

    // Create REQUEST message
    const request: RequestMessage = {
      type: MessageType.REQUEST,
      messageId,
      originPeerId: this.peerId,
      targetPeerId,
      ttl,
      timestamp: Date.now(),
      path: [],
      originPublicKey: this.keyManager.getPublicKey(),
      encryptedPayload,
      requestAttestation: options?.requireAttestation,
    };

    // Create promise for response
    return new Promise<Uint8Array>((resolve, reject) => {
      // Register pending request
      this.pendingRequests.register({
        messageId,
        targetPeerId,
        timestamp: Date.now(),
        timeout,
        resolve,
        reject,
      });

      // Route the message
      this.routeRequest(request, redundancy).catch((error) => {
        // If routing fails, reject the pending request
        this.pendingRequests.reject(
          messageId,
          error instanceof OverlayError
            ? error
            : new OverlayError(
                OverlayErrorCode.UNREACHABLE,
                `Failed to route message: ${error instanceof Error ? error.message : 'Unknown error'}`,
                { messageId, cause: error instanceof Error ? error : undefined }
              )
        );
      });
    });
  }

  /**
   * Register a handler for incoming messages.
   *
   * Requirement 2.1: Handler registration
   *
   * @param handler - The handler function to process incoming messages
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Remove the registered message handler.
   *
   * Requirement 2.5: Handler removal
   */
  offMessage(): void {
    this.messageHandler = null;
  }

  /**
   * Set a custom attestation verifier.
   *
   * Requirement 11.1: Attestation verifier registration
   *
   * @param verifier - The attestation verifier to use
   */
  setAttestationVerifier(verifier: AttestationVerifier): void {
    this.config.attestation.verifier = verifier;
  }

  /**
   * Get the current attestation verifier.
   *
   * Returns the configured verifier or a NoOpAttestationVerifier if none is set.
   *
   * @returns The current attestation verifier
   */
  getAttestationVerifier(): AttestationVerifier {
    return this.config.attestation.verifier ?? new NoOpAttestationVerifier();
  }

  /**
   * Check if attestation is enabled.
   *
   * @returns True if attestation is enabled
   */
  isAttestationEnabled(): boolean {
    return this.config.attestation.enabled;
  }

  /**
   * Get the handler code hash for this node.
   *
   * @returns The handler code hash or undefined if not set
   */
  getHandlerCodeHash(): string | undefined {
    return this.config.attestation.handlerCodeHash;
  }

  /**
   * Set the handler code hash for this node.
   *
   * Requirement 11.2: Include handler code hash in node announcements
   *
   * @param hash - The SHA-256 hash of the handler code
   */
  setHandlerCodeHash(hash: string): void {
    this.config.attestation.handlerCodeHash = hash;
  }


  // ============================================================================
  // Private Methods - Configuration
  // ============================================================================

  /**
   * Resolve configuration with defaults.
   *
   * Requirement 7.7: Apply sensible defaults when not configured
   */
  private resolveConfig(config?: OverlayConfig): ResolvedOverlayConfig {
    return {
      maxMessageSize: config?.maxMessageSize ?? DEFAULT_OVERLAY_CONFIG.maxMessageSize,
      defaultTTL: config?.defaultTTL ?? DEFAULT_OVERLAY_CONFIG.defaultTTL,
      dedupeWindowMs: config?.dedupeWindowMs ?? DEFAULT_OVERLAY_CONFIG.dedupeWindowMs,
      defaultRedundancy: config?.defaultRedundancy ?? DEFAULT_OVERLAY_CONFIG.defaultRedundancy,
      responseTimeout: config?.responseTimeout ?? DEFAULT_OVERLAY_CONFIG.responseTimeout,
      encryption: {
        enabled: config?.encryption?.enabled ?? DEFAULT_ENCRYPTION_CONFIG.enabled,
        keyPublishInterval:
          config?.encryption?.keyPublishInterval ?? DEFAULT_ENCRYPTION_CONFIG.keyPublishInterval,
        keyCacheTTL: config?.encryption?.keyCacheTTL ?? DEFAULT_ENCRYPTION_CONFIG.keyCacheTTL,
      },
      attestation: {
        enabled: config?.attestation?.enabled ?? DEFAULT_ATTESTATION_CONFIG.enabled,
        verifier: config?.attestation?.verifier,
        handlerCodeHash: config?.attestation?.handlerCodeHash,
      },
    };
  }

  /**
   * Ensure the overlay network is started.
   */
  private ensureStarted(): void {
    if (!this.started) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Overlay network is not started. Call start() first.'
      );
    }
  }

  // ============================================================================
  // Private Methods - Protocol Handler
  // ============================================================================

  /**
   * Register the libp2p protocol handler for overlay messages.
   */
  private registerProtocolHandler(): void {
    const libp2p = this._dht.getLibp2pNode();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    libp2p.handle(OVERLAY_PROTOCOL_ID, async (data: any) => {
      // Cast to the correct stream type with source/sink
      const stream = data.stream as {
        source: AsyncIterable<{ subarray(): Uint8Array }>;
        sink: (data: Iterable<Uint8Array> | AsyncIterable<Uint8Array>) => Promise<void>;
        close: () => Promise<void>;
      };
      try {
        // Read the incoming message
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream.source) {
          chunks.push(chunk.subarray());
        }
        const messageData = this.concatenateArrays(chunks);

        // Process the message
        const response = await this.processIncomingMessage(messageData);

        // Send response if any
        if (response) {
          await stream.sink([response]);
        }
      } catch (error) {
        // Log error but don't crash
        console.error('Error handling overlay message:', error);
      } finally {
        await stream.close();
      }
    });
  }

  /**
   * Unregister the libp2p protocol handler.
   */
  private unregisterProtocolHandler(): void {
    const libp2p = this._dht.getLibp2pNode();
    libp2p.unhandle(OVERLAY_PROTOCOL_ID);
  }

  // ============================================================================
  // Private Methods - Message Routing
  // ============================================================================

  /**
   * Route a request message to the target.
   *
   * Requirement 1.4: Send via multiple parallel paths
   */
  private async routeRequest(request: RequestMessage, redundancy: number): Promise<void> {
    // Get next hops from router
    const routeResult = await this.router.routeMessage(request);

    if (routeResult.delivered) {
      // This node is the target - shouldn't happen for outgoing messages
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Cannot send message to self',
        { messageId: request.messageId }
      );
    }

    if (routeResult.error) {
      throw routeResult.error;
    }

    if (!routeResult.nextHops || routeResult.nextHops.length === 0) {
      throw new OverlayError(
        OverlayErrorCode.NO_ROUTE,
        'No route to target peer',
        {
          messageId: request.messageId,
          context: { targetPeerId: request.targetPeerId },
        }
      );
    }

    // Encode the request
    const encoded = this.wireProtocol.encodeRequest(request);

    // Send to multiple next hops for redundancy
    const hopsToUse = routeResult.nextHops.slice(0, redundancy);
    const sendPromises = hopsToUse.map((hop) => this.sendToNode(hop, encoded));

    // Wait for at least one send to succeed
    const results = await Promise.allSettled(sendPromises);
    const anySuccess = results.some((r) => r.status === 'fulfilled');

    if (!anySuccess) {
      throw new OverlayError(
        OverlayErrorCode.UNREACHABLE,
        'Failed to send message to any next hop',
        {
          messageId: request.messageId,
          context: { targetPeerId: request.targetPeerId, attemptedHops: hopsToUse },
        }
      );
    }

    // Record in dedup cache
    this.dedupCache.record(request.messageId, hopsToUse);
  }

  /**
   * Send encoded message data to a specific node.
   */
  private async sendToNode(peerId: string, data: Uint8Array): Promise<void> {
    const libp2p = this._dht.getLibp2pNode();
    const { peerIdFromString } = await import('@libp2p/peer-id');
    const targetPeerId = peerIdFromString(peerId);

    const rawStream = await libp2p.dialProtocol(targetPeerId, OVERLAY_PROTOCOL_ID);
    // Cast to the correct stream type with source/sink
    const stream = rawStream as unknown as {
      source: AsyncIterable<{ subarray(): Uint8Array }>;
      sink: (data: Iterable<Uint8Array> | AsyncIterable<Uint8Array>) => Promise<void>;
      close: () => Promise<void>;
    };
    try {
      await stream.sink([data]);

      // Read response if any
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream.source) {
        chunks.push(chunk.subarray());
      }

      if (chunks.length > 0) {
        const responseData = this.concatenateArrays(chunks);
        await this.processIncomingMessage(responseData);
      }
    } finally {
      await stream.close();
    }
  }


  // ============================================================================
  // Private Methods - Message Processing
  // ============================================================================

  /**
   * Process an incoming message.
   *
   * Requirements 3.1-3.3, 4.1: Deduplication and routing
   *
   * @param data - The raw message data
   * @returns Response data to send back, or undefined
   */
  private async processIncomingMessage(data: Uint8Array): Promise<Uint8Array | undefined> {
    // Decode the message
    let message: OverlayMessage;
    try {
      message = this.wireProtocol.decode(data);
    } catch (error) {
      // Requirement 8.5: Drop invalid messages silently
      console.warn('Received invalid overlay message:', error);
      return undefined;
    }

    switch (message.type) {
      case MessageType.REQUEST:
        return this.handleRequest(message);
      case MessageType.RESPONSE:
        return this.handleResponse(message);
      case MessageType.DUPLICATE:
        return this.handleDuplicate(message);
      case MessageType.UNREACHABLE:
        return this.handleUnreachable(message);
      default:
        return undefined;
    }
  }

  /**
   * Handle an incoming REQUEST message.
   *
   * Requirements 2.1-2.6, 3.1-3.3, 4.1-4.4, 9.7, 9.8
   */
  private async handleRequest(request: RequestMessage): Promise<Uint8Array | undefined> {
    // Requirement 3.1: Check deduplication cache
    if (this.dedupCache.isDuplicate(request.messageId)) {
      // Requirement 3.2: Respond with DUPLICATE message
      return this.wireProtocol.encodeDuplicate(request.messageId);
    }

    // Check if this node is the target
    if (this.router.isLocalTarget(request.targetPeerId)) {
      return this.processLocalRequest(request);
    }

    // Forward the message
    return this.forwardRequest(request);
  }

  /**
   * Process a request destined for this node.
   *
   * Requirements 2.1-2.6, 9.7, 9.8
   */
  private async processLocalRequest(request: RequestMessage): Promise<Uint8Array | undefined> {
    // Requirement 2.6: Check if handler is registered
    if (!this.messageHandler) {
      return this.wireProtocol.encodeUnreachable(request.messageId, UnreachableReason.NO_HANDLER);
    }

    // Requirement 9.7: Decrypt the payload
    let plaintext: Uint8Array;
    try {
      plaintext = await this.crypto.decrypt(
        request.encryptedPayload,
        this.keyManager.getKeyPair().privateKey
      );
    } catch (error) {
      // Requirement 8.6: Decryption failed
      return this.wireProtocol.encodeUnreachable(
        request.messageId,
        UnreachableReason.DECRYPTION_FAILED
      );
    }

    // Requirement 2.2: Invoke handler with origin peer ID and payload
    const context: MessageContext = {
      originPeerId: request.originPeerId,
      messageId: request.messageId,
    };

    let responsePayload: Uint8Array;
    let success = true;
    let errorMessage: string | undefined;

    try {
      responsePayload = await Promise.resolve(this.messageHandler(plaintext, context));
    } catch (error) {
      // Requirement 2.4: Handler threw an error
      success = false;
      errorMessage = error instanceof Error ? error.message : 'Handler error';
      responsePayload = new Uint8Array(0);
    }

    // Requirement 9.8: Encrypt response using origin's public keys
    const encryptedResponse = await this.crypto.encrypt(responsePayload, request.originPublicKey);

    // Build response message
    const response: ResponseMessage = {
      type: MessageType.RESPONSE,
      messageId: request.messageId,
      originPeerId: request.originPeerId,
      targetPeerId: this.peerId,
      path: [...request.path, this.peerId],
      encryptedPayload: encryptedResponse,
      success,
      errorMessage,
    };

    // Add attestation if requested
    if (request.requestAttestation && this.config.attestation.enabled) {
      response.attestation = this.createAttestation();
    }

    return this.wireProtocol.encodeResponse(response);
  }

  /**
   * Forward a request to the next hop.
   *
   * Requirements 3.3, 4.1-4.4
   */
  private async forwardRequest(request: RequestMessage): Promise<Uint8Array | undefined> {
    // Prepare message for forwarding (decrement TTL, update path)
    const prepared = this.router.prepareForForward(request);

    // Requirement 4.4: TTL expired
    if (prepared.type === MessageType.UNREACHABLE) {
      return this.wireProtocol.encodeUnreachable(request.messageId, UnreachableReason.TTL_EXPIRED);
    }

    const forwardedRequest = prepared as RequestMessage;

    // Get next hops
    const nextHops = await this.router.getNextHops(request.targetPeerId);

    // Requirement 4.5: No route
    if (nextHops.length === 0) {
      return this.wireProtocol.encodeUnreachable(request.messageId, UnreachableReason.NO_ROUTE);
    }

    // Requirement 3.3: Record message and forwarded peers
    this.dedupCache.record(request.messageId, nextHops);

    // Encode and forward
    const encoded = this.wireProtocol.encodeRequest(forwardedRequest);

    // Forward to all next hops (fire and forget for relay)
    for (const hop of nextHops) {
      this.sendToNode(hop, encoded).catch(() => {
        // Ignore forwarding errors - redundancy handles this
      });
    }

    return undefined; // No immediate response for forwarded messages
  }

  /**
   * Handle an incoming RESPONSE message.
   *
   * Requirement 5.4: First response wins
   * Requirement 11.4, 11.5: Verify attestation if requested
   */
  private async handleResponse(response: ResponseMessage): Promise<Uint8Array | undefined> {
    // Check if this is the origin (response destination)
    if (response.originPeerId === this.peerId) {
      // Verify attestation if it was requested and attestation is enabled
      if (this.config.attestation.enabled && response.attestation) {
        const verifier = this.getAttestationVerifier();
        const result = await verifier.verify(response.attestation);
        
        if (!result.valid) {
          // Requirement 11.5: Reject with ATTESTATION_FAILED if verification fails
          this.pendingRequests.reject(
            response.messageId,
            new OverlayError(
              OverlayErrorCode.ATTESTATION_FAILED,
              `Attestation verification failed: ${result.reason ?? 'Unknown reason'}`,
              { messageId: response.messageId }
            )
          );
          return undefined;
        }
      }

      // Decrypt the response payload
      let plaintext: Uint8Array;
      try {
        plaintext = await this.crypto.decrypt(
          response.encryptedPayload,
          this.keyManager.getKeyPair().privateKey
        );
      } catch (error) {
        // Decryption failed - reject the pending request
        this.pendingRequests.reject(
          response.messageId,
          new OverlayError(
            OverlayErrorCode.DECRYPTION_FAILED,
            'Failed to decrypt response',
            { messageId: response.messageId, cause: error instanceof Error ? error : undefined }
          )
        );
        return undefined;
      }

      // Check if handler returned an error
      if (!response.success) {
        this.pendingRequests.reject(
          response.messageId,
          new OverlayError(
            OverlayErrorCode.HANDLER_ERROR,
            response.errorMessage ?? 'Handler error',
            { messageId: response.messageId }
          )
        );
        return undefined;
      }

      // Requirement 5.4: First response wins
      this.pendingRequests.resolve(response.messageId, plaintext);
      return undefined;
    }

    // Forward response toward origin
    const routeResult = await this.router.routeResponse(response);

    if (routeResult.nextHops && routeResult.nextHops.length > 0) {
      // Update response path
      const forwardedResponse: ResponseMessage = {
        ...response,
        path: [...response.path, this.peerId],
      };

      const encoded = this.wireProtocol.encodeResponse(forwardedResponse);

      // Forward to next hop
      for (const hop of routeResult.nextHops) {
        this.sendToNode(hop, encoded).catch(() => {
          // Ignore forwarding errors
        });
      }
    }

    return undefined;
  }

  /**
   * Handle a DUPLICATE message.
   *
   * Requirement 3.2: Duplicate notification
   */
  private handleDuplicate(_message: DuplicateMessage): Uint8Array | undefined {
    // Duplicate messages are informational - no action needed
    return undefined;
  }

  /**
   * Handle an UNREACHABLE message.
   *
   * Requirements 1.5, 1.6, 8.2: Error handling
   */
  private handleUnreachable(message: UnreachableMessage): Uint8Array | undefined {
    // Map reason to error code
    let errorCode: OverlayErrorCode;
    let errorMessage: string;

    switch (message.reason) {
      case UnreachableReason.TTL_EXPIRED:
        errorCode = OverlayErrorCode.TTL_EXPIRED;
        errorMessage = 'Message TTL expired before reaching target';
        break;
      case UnreachableReason.TARGET_NOT_FOUND:
        errorCode = OverlayErrorCode.TARGET_NOT_FOUND;
        errorMessage = 'Target peer not found';
        break;
      case UnreachableReason.NO_ROUTE:
        errorCode = OverlayErrorCode.NO_ROUTE;
        errorMessage = 'No route to target peer';
        break;
      case UnreachableReason.NO_HANDLER:
        errorCode = OverlayErrorCode.NO_HANDLER;
        errorMessage = 'No handler registered at target';
        break;
      case UnreachableReason.DECRYPTION_FAILED:
        errorCode = OverlayErrorCode.DECRYPTION_FAILED;
        errorMessage = 'Decryption failed at target';
        break;
      case UnreachableReason.ATTESTATION_FAILED:
        errorCode = OverlayErrorCode.ATTESTATION_FAILED;
        errorMessage = 'Attestation verification failed';
        break;
      default:
        errorCode = OverlayErrorCode.UNREACHABLE;
        errorMessage = 'Target unreachable';
    }

    // Reject the pending request
    this.pendingRequests.reject(
      message.messageId,
      new OverlayError(errorCode, errorMessage, { messageId: message.messageId })
    );

    return undefined;
  }

  // ============================================================================
  // Private Methods - Attestation
  // ============================================================================

  /**
   * Create an attestation for this node.
   */
  private createAttestation(): NodeAttestation {
    return {
      peerId: this.peerId,
      handlerCodeHash: this.config.attestation.handlerCodeHash || '',
      timestamp: Date.now(),
      signature: new Uint8Array(64), // Placeholder - would be signed in production
    };
  }

  // ============================================================================
  // Private Methods - Utilities
  // ============================================================================

  /**
   * Concatenate multiple Uint8Arrays into one.
   */
  private concatenateArrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }
}
