// Password generator — Mitchell's rules (single source of truth; used by
// site assets Key Info AND the vault so every generated password matches):
//  - 12 chars
//  - At least one lowercase, uppercase, digit, special
//  - Exclude ambiguous glyphs: i, j, l, o (lower), I, O (upper), 0
// Crypto.getRandomValues for unbiased selection (no Math.random).
const PWD_LOWER = "abcdefghkmnpqrstuvwxyz";       // no i, j, l, o
const PWD_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";     // no I, O
const PWD_DIGITS = "123456789";                    // no 0
const PWD_SPECIAL = "!@#$%^&*-_+=";
const PWD_ALL = PWD_LOWER + PWD_UPPER + PWD_DIGITS + PWD_SPECIAL;
const PWD_LENGTH = 12;

// Rejection-sampled random int in [0, max). Avoids modulo bias.
function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / max) * max;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

function pickFrom(pool: string): string {
  return pool.charAt(randomInt(pool.length));
}

export function generatePassword(): string {
  const chars: string[] = [
    pickFrom(PWD_LOWER),
    pickFrom(PWD_UPPER),
    pickFrom(PWD_DIGITS),
    pickFrom(PWD_SPECIAL),
  ];
  while (chars.length < PWD_LENGTH) chars.push(pickFrom(PWD_ALL));
  // Fisher-Yates shuffle so the guaranteed-category chars aren't pinned to
  // the first four positions.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
