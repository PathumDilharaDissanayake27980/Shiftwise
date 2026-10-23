/**
 * WebCrypto helpers. Keys are derived with PBKDF2-SHA-256 (600,000 iterations, OWASP 2023 guidance)
 * and data is sealed with AES-256-GCM, which also authenticates it: a wrong passphrase or a tampered
 * file fails to decrypt instead of producing garbage.
 */

export const PBKDF2_ITERATIONS = 600_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function pbkdf2Bits(secret: string, salt: Uint8Array, iterations: number, bits: number): Promise<ArrayBuffer> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, bits);
}

async function aesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const raw = await pbkdf2Bits(passphrase, salt, iterations, 256);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export interface Sealed {
  alg: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export async function seal(plaintext: string, passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<Sealed> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await aesKey(passphrase, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(plaintext));
  return { alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ct)) };
}

export class DecryptError extends Error {
  constructor() {
    super('Wrong passphrase, or the file is damaged.');
    this.name = 'DecryptError';
  }
}

export async function open(sealed: Sealed, passphrase: string): Promise<string> {
  if (sealed.iterations < 100_000 || sealed.iterations > 5_000_000) throw new DecryptError();
  try {
    const key = await aesKey(passphrase, fromBase64(sealed.salt), sealed.iterations);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(sealed.iv) as BufferSource }, key, fromBase64(sealed.ciphertext) as BufferSource);
    return dec.decode(pt);
  } catch {
    throw new DecryptError();
  }
}

export interface PinRecord {
  salt: string;
  hash: string;
  iterations: number;
}

export async function hashPin(pin: string, iterations = PBKDF2_ITERATIONS): Promise<PinRecord> {
  const salt = randomBytes(16);
  const bits = await pbkdf2Bits(pin, salt, iterations, 256);
  return { salt: toBase64(salt), hash: toBase64(new Uint8Array(bits)), iterations };
}

/** Constant-time comparison of the derived hash. */
export async function verifyPin(pin: string, rec: PinRecord): Promise<boolean> {
  const bits = new Uint8Array(await pbkdf2Bits(pin, fromBase64(rec.salt), rec.iterations, 256));
  const expected = fromBase64(rec.hash);
  if (bits.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= (bits[i] ?? 0) ^ (expected[i] ?? 0);
  return diff === 0;
}
