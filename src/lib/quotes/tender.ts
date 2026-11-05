import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

/**
 * Tendering one quote to several builders (docs/job-lifecycle-CONTEXT.md
 * D10/D11). A public link is either the quote's own `response_token` (the
 * owner / customer link) or a `quote_builders.response_token` (one builder's
 * link). Everything customer-facing resolves the token through here so the
 * builder's name and tender state ride along.
 */

export type QuoteBuilderStatus = "pending" | "sent" | "accepted" | "declined" | "lost";

export interface TokenBuilder {
  /** quote_builders.id */
  id: string;
  siteBuilderId: string;
  name: string;
  email: string | null;
  contactName: string | null;
  status: QuoteBuilderStatus;
}

export interface ResolvedQuoteToken<Q> {
  quote: Q;
  builder: TokenBuilder | null;
  /**
   * What this link's holder should see: the quote's status for owner links;
   * for builder links their own accepted/declined, or "lost" once another
   * builder has been awarded the job.
   */
  effectiveStatus: string;
}

export async function resolveQuoteToken<Q extends { id: string; status: string; accepted_builder_id?: string | null }>(
  sb: SupabaseClient,
  token: string,
  select: string,
): Promise<ResolvedQuoteToken<Q> | null> {
  const { data: direct } = await sb.from("quotes").select(select).eq("response_token", token).maybeSingle();
  if (direct) {
    const quote = direct as unknown as Q;
    return { quote, builder: null, effectiveStatus: quote.status };
  }

  const { data: qb } = await sb
    .from("quote_builders")
    .select("id, quote_id, site_builder_id, status, builder:site_builders(name, email, contact_name)")
    .eq("response_token", token)
    .maybeSingle();
  if (!qb) return null;
  const { data: quoteRow } = await sb.from("quotes").select(select).eq("id", qb.quote_id).maybeSingle();
  if (!quoteRow) return null;
  const quote = quoteRow as unknown as Q;
  const b = Array.isArray(qb.builder) ? qb.builder[0] : qb.builder;
  const builder: TokenBuilder = {
    id: qb.id,
    siteBuilderId: qb.site_builder_id,
    name: b?.name ?? "Builder",
    email: b?.email ?? null,
    contactName: b?.contact_name ?? null,
    status: qb.status as QuoteBuilderStatus,
  };
  const effectiveStatus =
    builder.status === "accepted" ? "accepted"
    : builder.status === "declined" ? "declined"
    : builder.status === "lost" || (quote.status === "accepted" && quote.accepted_builder_id !== builder.siteBuilderId) ? "lost"
    : quote.status;
  return { quote, builder, effectiveStatus };
}

/** Mint a token for a builder's link (idempotent — re-sends keep the link). */
export function newResponseToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
