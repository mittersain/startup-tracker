import CryptoJS from 'crypto-js';

/**
 * Get encryption key from environment
 * @throws Error if ENCRYPTION_KEY is not set or too short
 */
function getEncryptionKey(): string {
  const key = process.env['ENCRYPTION_KEY'];
  if (!key || key.length < 32) {
    throw new Error('ENCRYPTION_KEY environment variable must be set and at least 32 characters');
  }
  return key;
}

/**
 * Encrypt sensitive data (e.g., email passwords)
 * @param plaintext - The text to encrypt
 * @returns Encrypted string
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    throw new Error('Cannot encrypt empty string');
  }

  const key = getEncryptionKey();
  return CryptoJS.AES.encrypt(plaintext, key).toString();
}

/**
 * Decrypt sensitive data
 * @param ciphertext - The encrypted text
 * @returns Decrypted string
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) {
    throw new Error('Cannot decrypt empty string');
  }

  const key = getEncryptionKey();
  const bytes = CryptoJS.AES.decrypt(ciphertext, key);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);

  if (!decrypted) {
    throw new Error('Decryption failed - invalid ciphertext or wrong key');
  }

  return decrypted;
}

/**
 * Check if a string appears to be encrypted
 * @param value - The value to check
 * @returns true if the value looks like encrypted data
 */
export function isEncrypted(value: string): boolean {
  // AES encrypted strings from crypto-js start with "U2FsdGVkX1" (base64 of "Salted__")
  return value.startsWith('U2FsdGVk');
}
