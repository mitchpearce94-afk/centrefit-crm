/**
 * "Billed to" line on the invoice page (docs/billing-contact-CONTEXT.md D1).
 * Display only — Preview PDF and "Change billed-to contact" live in the
 * header's 3-dot menu (InvoiceActions), per Mitchell 2026-09-16.
 */
export function BillTo({ billToName, hasXero, party = "owner" }: { billToName: string | null; hasXero: boolean; party?: "owner" | "builder" | string | null }) {
  return (
    <p className="mt-1.5 text-sm">
      <span className="text-muted-foreground">Billed to </span>
      <span className="font-medium text-foreground">
        {billToName ?? (hasXero ? <span className="italic text-muted-foreground">not synced yet — Refresh from Xero</span> : "—")}
      </span>
      {party === "builder" && (
        <span className="ml-2 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-500" title="Builder invoice — the owner stays on the recurring plans">
          Builder
        </span>
      )}
    </p>
  );
}
