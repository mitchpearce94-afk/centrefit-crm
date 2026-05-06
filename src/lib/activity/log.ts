import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lightweight wrapper for inserting into document_activity. Logging
 * failures should never break the parent operation — every call is
 * wrapped so a missing table or RLS hiccup doesn't 500 a webhook.
 *
 * Use the SAME supabase client the caller is already using:
 *   - Server-action / route handler (with user)         → /lib/supabase/server
 *   - Webhook handler (no user, needs service-role)     → /lib/supabase/service
 * The RLS policy allows authenticated INSERT and lets service-role bypass.
 */
export type DocumentType = "quote" | "invoice" | "recurring_plan" | "plan";

export interface LogActivityInput {
  supabase: SupabaseClient;
  documentType: DocumentType;
  documentId: string;
  eventType: string;
  /** "system" | "recipient" | staff.id */
  actor?: string;
  metadata?: Record<string, unknown>;
}

export async function logDocumentActivity(input: LogActivityInput): Promise<void> {
  const { supabase, documentType, documentId, eventType, actor = "system", metadata } = input;
  try {
    await supabase.from("document_activity").insert({
      document_type: documentType,
      document_id: documentId,
      event_type: eventType,
      actor,
      metadata: metadata ?? null,
    });
  } catch (err) {
    // Swallow but log — never break the parent flow.
    console.error("[activity] log failed", { eventType, documentId, err });
  }
}

/**
 * View dedupe helper: returns true if the same recipient+document has
 * logged a 'viewed' event from the same IP within the last `withinMs`
 * milliseconds. Used by the public quote-view route to avoid flooding the
 * timeline when a customer reloads / scrolls back / shares the link.
 */
export async function shouldLogView(
  supabase: SupabaseClient,
  documentType: DocumentType,
  documentId: string,
  ip: string,
  withinMs = 60 * 60 * 1000,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - withinMs).toISOString();
  const { data } = await supabase
    .from("document_activity")
    .select("id, metadata")
    .eq("document_type", documentType)
    .eq("document_id", documentId)
    .eq("event_type", `${documentType}.viewed`)
    .gte("event_at", cutoff)
    .limit(50);
  if (!data || data.length === 0) return true;
  return !data.some((r) => (r.metadata as { ip?: string } | null)?.ip === ip);
}
