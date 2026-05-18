// Vault crypto — runs in the browser. The server never sees plaintext
// passwords, the master password, the encryption key, or unwrapped folder
// keys. Per docs/vault-CONTEXT.md D1, D2.
//
// Primitives:
//   - PBKDF2-SHA256, 600,000 iterations (D2, matches OWASP 2023 + Mark's
//     existing vault).
//   - RSA-OAEP-4096 keypair per staff (D1, OQ1 — Mitchell picked RSA over
//     Curve25519 to avoid a WASM dep).
//   - AES-256-GCM for: wrapping the user's private key with the master-derived
//     key; wrapping each folder key with the user's public key; and
//     encrypting entries with their folder key. 12-byte random IVs.
//
// All ciphertext / wrapped keys / IVs are transported as base64 strings.

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_HASH = "SHA-256";
const AES_GCM_IV_BYTES = 12;
const RSA_MODULUS_BITS = 4096;

// ── encoding helpers ────────────────────────────────────────────────────
// TS 5.6+ tightened Uint8Array<ArrayBufferLike> vs Uint8Array<ArrayBuffer>.
// All our byte arrays back ArrayBuffers (we never use SharedArrayBuffer);
// `asBs()` casts to the BufferSource union the WebCrypto lib accepts.
function asBs(b: Uint8Array): BufferSource {
  return b as BufferSource;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function fromUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

// ── PBKDF2: master password → (auth_key, encryption_key) ────────────────
//
// We derive 64 bytes total: first 32 = auth_key (sent to server, bcrypted),
// second 32 = encryption_key (kept in browser, used to wrap the private key).
// Both halves come from the same PBKDF2 stretch — single 600k cost.

export async function deriveKeysFromMasterPassword(
  masterPassword: string,
  saltB64: string,
): Promise<{ authKeyB64: string; encryptionKey: CryptoKey }> {
  const salt = b64ToBytes(saltB64);
  const passKey = await crypto.subtle.importKey(
    "raw",
    asBs(utf8(masterPassword)),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: asBs(salt), iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    passKey,
    64 * 8,
  );
  const buf = new Uint8Array(bits);
  const authKey = new Uint8Array(buf.subarray(0, 32));
  const encRaw = new Uint8Array(buf.subarray(32, 64));
  const encryptionKey = await crypto.subtle.importKey(
    "raw", asBs(encRaw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"],
  );
  return { authKeyB64: bytesToB64(authKey), encryptionKey };
}

export function newPbkdf2Salt(): string {
  return bytesToB64(randomBytes(16));
}

// ── RSA-OAEP-4096 keypair ───────────────────────────────────────────────

export async function generateRsaKeypair(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}> {
  const kp = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: RSA_MODULUS_BITS,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );
  return kp as { publicKey: CryptoKey; privateKey: CryptoKey };
}

export async function exportPublicKeyB64(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  return bytesToB64(new Uint8Array(spki));
}

export async function importPublicKeyB64(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    asBs(b64ToBytes(b64)),
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["encrypt", "wrapKey"],
  );
}

export async function exportPrivateKeyRaw(privateKey: CryptoKey): Promise<Uint8Array> {
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
  return new Uint8Array(pkcs8);
}

export async function importPrivateKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    asBs(raw),
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["decrypt", "unwrapKey"],
  );
}

// ── AES-GCM wrap/unwrap (used for both private-key wrapping and entry payloads) ─

export async function aesGcmEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<{ ciphertextB64: string; ivB64: string }> {
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBs(iv) }, key, asBs(plaintext));
  return { ciphertextB64: bytesToB64(new Uint8Array(ct)), ivB64: bytesToB64(iv) };
}

export async function aesGcmDecrypt(
  key: CryptoKey,
  ciphertextB64: string,
  ivB64: string,
): Promise<Uint8Array> {
  const ct = b64ToBytes(ciphertextB64);
  const iv = b64ToBytes(ivB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: asBs(iv) }, key, asBs(ct));
  return new Uint8Array(pt);
}

// ── Folder symmetric key (AES-256-GCM) ──────────────────────────────────

export async function generateFolderKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt", "decrypt",
  ]);
}

export async function exportFolderKeyRaw(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return new Uint8Array(raw);
}

export async function importFolderKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asBs(raw), { name: "AES-GCM" }, true, [
    "encrypt", "decrypt",
  ]);
}

// Wrap a folder key with a recipient's RSA public key.
export async function wrapFolderKeyForPublicKey(
  folderKey: CryptoKey,
  recipientPublicKey: CryptoKey,
): Promise<string> {
  const raw = await exportFolderKeyRaw(folderKey);
  const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, recipientPublicKey, asBs(raw));
  return bytesToB64(new Uint8Array(wrapped));
}

export async function unwrapFolderKey(
  wrappedB64: string,
  privateKey: CryptoKey,
): Promise<CryptoKey> {
  const wrapped = b64ToBytes(wrappedB64);
  const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, asBs(wrapped));
  return importFolderKeyRaw(new Uint8Array(raw));
}

// ── Entry payload shape ─────────────────────────────────────────────────

export interface VaultEntryPayload {
  title: string;
  url?: string;
  username?: string;
  password?: string;
  notes?: string;
  totpSecret?: string;
  customFields?: { label: string; value: string }[];
}

export async function encryptEntry(
  folderKey: CryptoKey,
  payload: VaultEntryPayload,
): Promise<{ ciphertextB64: string; ivB64: string }> {
  return aesGcmEncrypt(folderKey, utf8(JSON.stringify(payload)));
}

export async function decryptEntry(
  folderKey: CryptoKey,
  ciphertextB64: string,
  ivB64: string,
): Promise<VaultEntryPayload> {
  const bytes = await aesGcmDecrypt(folderKey, ciphertextB64, ivB64);
  return JSON.parse(fromUtf8(bytes)) as VaultEntryPayload;
}

// ── Recovery code ────────────────────────────────────────────────────────
//
// 24 bytes = ~38 base32 chars. Display grouped as four-char blocks. The
// recovery code is itself a master secret — used the same way as a master
// password (PBKDF2 → encryption key → unwraps the recovery-wrapped private
// key). Store nowhere on the server; the user prints / saves it.

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 (visually safe)

export function generateRecoveryCode(): string {
  const bytes = randomBytes(24);
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    if ((i + 1) % 4 === 0 && i !== bytes.length - 1) s += "-";
  }
  return s;
}

export function normaliseRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ── Master password ↔ private key wrapping ──────────────────────────────

export async function wrapPrivateKeyWithMasterKey(
  privateKey: CryptoKey,
  masterEncryptionKey: CryptoKey,
): Promise<{ ciphertextB64: string; ivB64: string }> {
  const raw = await exportPrivateKeyRaw(privateKey);
  return aesGcmEncrypt(masterEncryptionKey, raw);
}

export async function unwrapPrivateKeyWithMasterKey(
  wrappedB64: string,
  ivB64: string,
  masterEncryptionKey: CryptoKey,
): Promise<CryptoKey> {
  const raw = await aesGcmDecrypt(masterEncryptionKey, wrappedB64, ivB64);
  return importPrivateKeyRaw(raw);
}
