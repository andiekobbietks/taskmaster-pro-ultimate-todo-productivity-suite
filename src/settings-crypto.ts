/**
 * Web Crypto encryption for sensitive settings values.
 *
 * - Values are encrypted with AES-256-GCM.
 * - The key is derived from `env.SETTINGS_ENCRYPTION_KEY` via PBKDF2.
 * - Encrypted values are prefixed with `enc:v1:` so legacy XOR values can be
 *   migrated on write.
 * - If no encryption key is configured, values are stored unchanged. This lets
 *   the test suite run without secrets; production should always set the key.
 */

const PREFIX = "enc:v1:";

function getSecret(env: any): string | null {
  return env?.SETTINGS_ENCRYPTION_KEY || null;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("taskmaster-pro-settings"),
      iterations: 100000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

const keyCache = new Map<string, Promise<CryptoKey>>();

async function getEncryptionKey(env: any): Promise<CryptoKey | null> {
  const secret = getSecret(env);
  if (!secret) return null;
  if (!keyCache.has(secret)) {
    keyCache.set(secret, deriveKey(secret));
  }
  return keyCache.get(secret)!;
}

/**
 * Encrypt one sensitive value. Returns the plaintext when no key is set.
 */
export async function encryptSetting(value: string, env: any): Promise<string> {
  if (!value) return value;
  const key = await getEncryptionKey(env);
  if (!key) return value;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(value));
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ct), iv.length);
  const b64 = btoa(String.fromCharCode(...combined));
  return PREFIX + b64;
}

/**
 * Decrypt one value. Returns the raw string for legacy (non-prefixed) values
 * so the caller can fall back to legacy deobfuscation.
 */
export async function decryptSetting(value: string, env: any): Promise<string> {
  if (!value) return value;
  if (!value.startsWith(PREFIX)) return value;
  const key = await getEncryptionKey(env);
  if (!key) return "";
  try {
    const data = Uint8Array.from(atob(value.slice(PREFIX.length)), (c) => c.charCodeAt(0));
    const iv = data.slice(0, 12);
    const ct = data.slice(12);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return "";
  }
}

/**
 * True if the value is already in the new encrypted format.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}
