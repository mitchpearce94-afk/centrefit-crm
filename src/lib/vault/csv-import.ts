// Small RFC 4180-ish CSV parser. Handles quoted fields containing commas,
// newlines, and escaped quotes. Used by the vault import flow to ingest
// exports from Norton, 1Password, Bitwarden, LastPass, etc.

export interface ParsedRow {
  [header: string]: string;
}

/** Parse CSV text into an array of header-keyed row objects. */
export function parseCsv(text: string): ParsedRow[] {
  const records = parseCsvToRecords(text);
  if (records.length === 0) return [];
  const headers = records[0].map((h) => h.trim());
  const rows: ParsedRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const cells = records[i];
    if (cells.length === 1 && cells[0].trim() === "") continue; // blank line
    const row: ParsedRow = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = cells[c] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function parseCsvToRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  // Normalise CRLF to LF — easier state machine.
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        row.push(field);
        field = "";
        i++;
      } else if (ch === "\n") {
        row.push(field);
        records.push(row);
        row = [];
        field = "";
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }
  // Trailing field / row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return records;
}

// ── Column auto-mapping ────────────────────────────────────────────────
// Accept common variants from Norton/1Password/Bitwarden/LastPass.

const HEADER_ALIASES: Record<string, string[]> = {
  title: ["title", "name", "item name"],
  url: ["url", "website", "web address", "uri", "login uri"],
  username: ["username", "user name", "user", "login", "login username", "email"],
  password: ["password", "pwd", "login password"],
  notes: ["notes", "note", "extra", "comments", "additional information"],
  totp: ["totp", "otp", "one-time password", "totp_secret", "totpsecret", "authenticator key"],
  folder: ["folder", "grouping", "category", "tag"],
};

export interface NormalisedRow {
  title: string;
  url?: string;
  username?: string;
  password?: string;
  notes?: string;
  totpSecret?: string;
  folder?: string;        // source folder hint — not used directly, surfaced for review
}

/**
 * Map a raw parsed row to the entry payload shape based on known column
 * aliases. Returns null if no recognisable title.
 */
export function normaliseRow(row: ParsedRow): NormalisedRow | null {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    lower[k.toLowerCase().trim()] = v;
  }
  function pick(key: keyof typeof HEADER_ALIASES): string | undefined {
    for (const alias of HEADER_ALIASES[key]) {
      const v = lower[alias];
      if (v !== undefined && v.trim() !== "") return v.trim();
    }
    return undefined;
  }

  const title = pick("title");
  if (!title) return null;

  return {
    title,
    url: pick("url"),
    username: pick("username"),
    password: pick("password"),
    notes: pick("notes"),
    totpSecret: pick("totp"),
    folder: pick("folder"),
  };
}
