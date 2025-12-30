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
export function xorDistance(a, b) {
    const maxLen = Math.max(a.length, b.length);
    const result = new Uint8Array(maxLen);
    for (let i = 0; i < maxLen; i++) {
        result[i] = (a[i] || 0) ^ (b[i] || 0);
    }
    return result;
}
/**
 * Compare two XOR distances.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 * Comparison is done byte-by-byte from most significant to least significant.
 *
 * @param a - First distance (byte array)
 * @param b - Second distance (byte array)
 * @returns -1, 0, or 1 indicating comparison result
 */
export function compareDistance(a, b) {
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
        const byteA = a[i] || 0;
        const byteB = b[i] || 0;
        if (byteA < byteB)
            return -1;
        if (byteA > byteB)
            return 1;
    }
    return 0;
}
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
export function getBucketIndex(localId, peerId) {
    const distance = xorDistance(localId, peerId);
    // Find the first non-zero byte
    for (let i = 0; i < distance.length; i++) {
        const byte = distance[i];
        if (byte !== 0) {
            // Find the position of the first set bit in this byte
            // clz32 counts leading zeros in a 32-bit integer, so we adjust for 8-bit byte
            const leadingZerosInByte = Math.clz32(byte) - 24;
            // Calculate bucket index: (byte position * 8) + leading zeros in that byte
            // Then invert so that closer peers have higher bucket indices
            const bitPosition = i * 8 + leadingZerosInByte;
            // For 256-bit (32-byte) key space, max bucket index is 255
            return 255 - bitPosition;
        }
    }
    // IDs are identical - return -1 to indicate this edge case
    return -1;
}
//# sourceMappingURL=distance.js.map