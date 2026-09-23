import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Every decision and every Xero write leaves a row (docs/finance-CONTEXT.md D11).
export interface AuditEntry {
  actor?: string; // 'agent' | staff id / email
  action: string; // e.g. payout.matched, payout.posted, contact.linked, settings.updated
  entity?: string; // finance_payouts | finance_payout_items | finance_gc_customers | xero.payment | ...
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  rule?: string; // the D-number / rule applied
  note?: string;
}

export async function audit(svc: SupabaseClient, e: AuditEntry): Promise<void> {
  const { error } = await svc.from("finance_agent_actions").insert({
    actor: e.actor ?? "agent",
    action: e.action,
    entity: e.entity ?? null,
    entity_id: e.entityId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    rule: e.rule ?? null,
    note: e.note ?? null,
  });
  if (error) console.error("[finance] audit insert failed:", error.message);
}
