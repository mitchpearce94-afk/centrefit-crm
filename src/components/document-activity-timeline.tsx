import { createClient } from "@/lib/supabase/server";

/**
 * Server component that renders the activity timeline for a single
 * document. Fetches `document_activity` rows newest-first and renders
 * them as a vertical list with type-specific icons and colours. Drop in
 * on a quote or invoice detail page; works for any document_type.
 */

interface ActivityRow {
  id: string;
  event_type: string;
  event_at: string;
  actor: string;
  metadata: Record<string, unknown> | null;
}

const EVENT_LABEL: Record<string, string> = {
  // Quotes
  "quote.sent": "Quote sent",
  "quote.viewed": "Customer opened the quote",
  "quote.accepted": "Customer accepted",
  "quote.declined": "Customer declined",
  "quote.email_delivered": "Email delivered",
  "quote.email_opened": "Email opened",
  "quote.email_bounced": "Email bounced",
  "quote.email_clicked": "Customer clicked a link",
  "quote.email_complained": "Customer marked as spam",

  // Invoices
  "invoice.created": "Invoice created",
  "invoice.authorised": "Authorised in Xero",
  "invoice.authorised_in_xero": "Authorised in Xero",
  "invoice.paid": "Paid",
  "invoice.voided": "Voided",
  "invoice.status_changed": "Status changed",
  "invoice.email_delivered": "Email delivered",
  "invoice.email_opened": "Email opened",
  "invoice.email_bounced": "Email bounced",
  "invoice.email_clicked": "Customer clicked a link",
  "invoice.email_complained": "Customer marked as spam",
};

const EVENT_ICON: Record<string, { glyph: string; color: string }> = {
  "quote.sent": { glyph: "→", color: "#3b82f6" },
  "quote.viewed": { glyph: "👁", color: "#a78bfa" },
  "quote.accepted": { glyph: "✓", color: "#22c55e" },
  "quote.declined": { glyph: "×", color: "#ef4444" },
  "quote.email_delivered": { glyph: "✉", color: "#64748b" },
  "quote.email_opened": { glyph: "✉", color: "#a78bfa" },
  "quote.email_bounced": { glyph: "⚠", color: "#ef4444" },
  "quote.email_clicked": { glyph: "↗", color: "#3b82f6" },

  "invoice.created": { glyph: "+", color: "#3b82f6" },
  "invoice.authorised": { glyph: "✓", color: "#0ea5e9" },
  "invoice.authorised_in_xero": { glyph: "✓", color: "#0ea5e9" },
  "invoice.paid": { glyph: "$", color: "#22c55e" },
  "invoice.voided": { glyph: "×", color: "#ef4444" },
  "invoice.email_delivered": { glyph: "✉", color: "#64748b" },
  "invoice.email_opened": { glyph: "✉", color: "#a78bfa" },
  "invoice.email_bounced": { glyph: "⚠", color: "#ef4444" },
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function actorLabel(actor: string, staffMap: Map<string, string>): string {
  if (actor === "system") return "Automation";
  if (actor === "recipient") return "Customer";
  return staffMap.get(actor) ?? "Staff";
}

export async function DocumentActivityTimeline({
  documentType,
  documentId,
}: {
  documentType: "quote" | "invoice" | "recurring_plan";
  documentId: string;
}) {
  const supabase = await createClient();

  const [{ data: rows }, { data: staff }] = await Promise.all([
    supabase
      .from("document_activity")
      .select("id, event_type, event_at, actor, metadata")
      .eq("document_type", documentType)
      .eq("document_id", documentId)
      .order("event_at", { ascending: false })
      .limit(100),
    supabase.from("staff").select("id, display_name"),
  ]);

  const events = (rows ?? []) as ActivityRow[];
  const staffMap = new Map((staff ?? []).map((s) => [s.id, s.display_name as string]));

  if (events.length === 0) {
    return (
      <div className="surface-card p-5">
        <h2 className="text-sm font-semibold mb-3">Activity</h2>
        <p className="text-xs text-muted-foreground">No activity yet — events will appear here as the document is sent, viewed, and paid.</p>
      </div>
    );
  }

  return (
    <div className="surface-card p-5">
      <h2 className="text-sm font-semibold mb-4">Activity</h2>
      <ol className="space-y-3">
        {events.map((ev) => {
          const icon = EVENT_ICON[ev.event_type] ?? { glyph: "·", color: "#64748b" };
          const label = EVENT_LABEL[ev.event_type] ?? ev.event_type;
          return (
            <li key={ev.id} className="flex gap-3">
              <div
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{ backgroundColor: `${icon.color}20`, color: icon.color }}
              >
                {icon.glyph}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm">{label}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {actorLabel(ev.actor, staffMap)} · {fmtTime(ev.event_at)}
                </div>
                {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                  <ActivityMeta metadata={ev.metadata} eventType={ev.event_type} />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ActivityMeta({ metadata, eventType }: { metadata: Record<string, unknown>; eventType: string }) {
  // Render a small subset of metadata that's actually useful inline.
  // Full metadata is on the row for debugging if needed.
  const bits: string[] = [];
  if (eventType === "quote.sent" || eventType === "invoice.email_delivered") {
    if (metadata.to) bits.push(`to: ${String(metadata.to)}`);
  }
  if (eventType === "invoice.paid" || eventType === "invoice.status_changed") {
    if (metadata.amount_paid) bits.push(`paid: $${Number(metadata.amount_paid).toFixed(2)}`);
  }
  if (eventType === "quote.viewed") {
    const ua = String(metadata.user_agent ?? "");
    if (ua) {
      const m = ua.match(/\(([^)]+)\)/);
      if (m) bits.push(m[1]);
    }
  }
  if (bits.length === 0) return null;
  return (
    <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
      {bits.join(" · ")}
    </div>
  );
}
