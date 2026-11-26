// Shared bits for the SIM pages (client-safe — no server imports).

const TONE: Record<string, string> = {
  ACTIVATED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  ACTIVATION_READY: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  TEST_READY: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  DEACTIVATED: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function SimStatusBadge({ status }: { status: string | null | undefined }) {
  const cls = (status && TONE[status]) || "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {status ? status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "Unknown"}
    </span>
  );
}

export function formatBytesClient(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-AU", { timeZone: "Australia/Brisbane", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
