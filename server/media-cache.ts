// Ciphertext only. Never store playback keys or decrypted content in this cache.
const entries = new Map<string, { bytes: Buffer; expires: number }>();
const limit = 128 * 1024 * 1024;
let used = 0;
export function forgetCipher(key: string) {
  const value = entries.get(key);
  if (value) {
    used -= value.bytes.length;
    entries.delete(key);
  }
}
export function cachedCipher(key: string): Buffer | undefined {
  const value = entries.get(key);
  if (!value) return;
  if (value.expires <= Date.now()) {
    forgetCipher(key);
    return;
  }
  entries.delete(key);
  entries.set(key, value);
  return value.bytes;
}
export function cacheCipher(key: string, bytes: Buffer) {
  if (bytes.length > 16 * 1024 * 1024) return;
  forgetCipher(key);
  while (used + bytes.length > limit && entries.size) forgetCipher(entries.keys().next().value!);
  entries.set(key, { bytes, expires: Date.now() + 15 * 60 * 1000 });
  used += bytes.length;
}
