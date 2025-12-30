/**
 * XOR distance utilities for Kademlia DHT
 *
 * The Kademlia protocol uses XOR distance metric for routing decisions.
 * Distance between two keys is calculated as the XOR of their byte representations.
 */
/**
 * Calculate XOR distance between two byte arrays.
 * The result is a byte array representing the XOR of the two inputs.
 *
 * @param a - First byte array (peer ID or key)
 * @param b - Second byte array (peer ID or key)
 * @returns XOR distance as a byte array
 */
export declare function xorDistance(a: Uint8Array, b: Uint8Array): Uint8Array;
/**
 * Compare two XOR distances.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 * Comparison is done byte-by-byte from most significant to least significant.
 *
 * @param a - First distance (byte array)
 * @param b - Second distance (byte array)
 * @returns -1, 0, or 1 indicating comparison result
 */
export declare function compareDistance(a: Uint8Array, b: Uint8Array): number;
/**
 * Get the k-bucket index for a peer based on XOR distance from local ID.
 * The bucket index is determined by the position of the first differing bit
 * (i.e., the number of leading zeros in the XOR distance).
 *
 * For a 256-bit key space, bucket indices range from 0 to 255.
 * Bucket 0 contains peers with the largest distance (first bit differs).
 * Bucket 255 contains peers with the smallest distance (only last bit differs).
 *
 * @param localId - Local peer's ID as byte array
 * @param peerId - Remote peer's ID as byte array
 * @returns Bucket index in range [0, 255], or -1 if IDs are identical
 */
export declare function getBucketIndex(localId: Uint8Array, peerId: Uint8Array): number;
//# sourceMappingURL=distance.d.ts.map