// Shared by the cockpit page (server) and RunTest (client): flatten Kinetix
// payloads into readable key/value rows and render timestamps in our time.

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

export function formatValue(v: unknown): string {
  if (typeof v === "string" && ISO_RE.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("en-AU", {
        timeZone: "Australia/Brisbane",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    }
  }
  return String(v);
}

/**
 * Recursively flatten an object into dot-path rows of scalars, so nested
 * diagnostic results (e.g. testResult.downstreamRate) actually show instead
 * of hiding in the raw JSON. Arrays of objects flatten their first item;
 * `href`-style noise is dropped.
 */
export function flattenRows(data: unknown, maxRows = 28): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const walk = (val: unknown, path: string, depth: number) => {
    if (rows.length >= maxRows || val == null) return;
    if (["string", "number", "boolean"].includes(typeof val)) {
      if (/(^|\.)href$/i.test(path)) return;
      rows.push([path, formatValue(val)]);
      return;
    }
    if (depth >= 4) return;
    if (Array.isArray(val)) {
      if (val.length === 0) return;
      if (["string", "number", "boolean"].includes(typeof val[0])) {
        rows.push([path, val.slice(0, 6).map(String).join(", ") + (val.length > 6 ? "…" : "")]);
        return;
      }
      val.slice(0, 3).forEach((item, i) => walk(item, val.length > 1 ? `${path}[${i}]` : path, depth + 1));
      return;
    }
    if (typeof val === "object") {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (k.startsWith("@")) continue;
        walk(v, path ? `${path}.${k}` : k, depth + 1);
      }
    }
  };
  walk(Array.isArray(data) ? data[0] : data, "", 0);
  return rows;
}
