// RFC 6238 TOTP — 30-second step, 6 digits, SHA-1.
// Implemented via WebCrypto HMAC. Runs in the browser only (the secret is
// already decrypted in the unlocked vault session).

function base32Decode(input: string): Uint8Array {
  // Tolerant of whitespace, lowercase, padding.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bytes: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of cleaned) {
    const v = alphabet.indexOf(ch);
    if (v < 0) continue;
    buf = (buf << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function asBs(b: Uint8Array): BufferSource {
  return b as BufferSource;
}

export async function computeTotp(secretBase32: string, atMs = Date.now()): Promise<string> {
  const key = base32Decode(secretBase32);
  if (key.length === 0) throw new Error("Empty TOTP secret");

  const counter = Math.floor(atMs / 1000 / 30);
  // 8-byte big-endian counter
  const counterBytes = new Uint8Array(8);
  const view = new DataView(counterBytes.buffer);
  // JS bitwise ops are 32-bit; split.
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);

  const cryptoKey = await crypto.subtle.importKey(
    "raw", asBs(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, asBs(counterBytes)));
  const offset = sig[sig.length - 1] & 0x0f;
  const code =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export function secondsRemainingInTotpStep(nowMs = Date.now()): number {
  return 30 - Math.floor(nowMs / 1000) % 30;
}
