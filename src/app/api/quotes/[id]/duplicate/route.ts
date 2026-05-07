import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Clone an existing quote into a fresh draft, ref-allocated for the current
 * year. Used when Mitchell needs to send a customer two side-by-side options
 * (e.g. with vs without certain inclusions) for the same job.
 *
 * What carries: customer/site/job linkage, quote_type, all sizing fields,
 * device_counts, labour_data, pricing_snapshot, scope_overrides, line items
 * and extras. The duplicate stays linked to the same job so the work it
 * represents is still discoverable from the job page.
 *
 * What resets: ref (new), status ('draft'), all send / accept / decline /
 * payment / followup / expiry timestamps, auto-invoice attempt fields,
 * created_by (current user), created_at / updated_at (DB defaults).
 *
 * What is NOT copied: invoices (one quote → one invoice chain), plan_files
 * (they stay attached to the source — admin re-links if needed).
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: source, error: srcErr } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", id)
    .single();
  if (srcErr || !source) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  // Strip fields that must be regenerated or reset on the copy. Spread the
  // rest so any new column added to the schema is automatically carried
  // forward without touching this route — the only fields we hand-craft are
  // the ones in the second `payload` block below.
  const {
    id: _id,
    ref: _ref,
    status: _status,
    sent_at: _sentAt,
    sent_to_email: _sentTo,
    response_token: _respTok,
    accepted_at: _acc,
    declined_at: _dec,
    pp1_paid: _p1,
    pp2_paid: _p2,
    pp1_paid_at: _p1At,
    pp2_paid_at: _p2At,
    auto_invoice_attempted_at: _autoAt,
    auto_invoice_error: _autoErr,
    followup_sent_at: _fuAt,
    followup_count: _fuCount,
    expires_at: _exp,
    created_at: _cAt,
    updated_at: _uAt,
    created_by: _cBy,
    ...carryOver
  } = source as Record<string, unknown>;

  // Allocate the next ref for this year, with collision retry. Same shape
  // as the wizard's allocator — see quote-wizard.tsx for the original logic.
  const year = new Date().getFullYear();
  const refPrefix = `CF-${year}-`;
  const { data: yearQuotes, error: refErr } = await supabase
    .from("quotes")
    .select("ref")
    .like("ref", `${refPrefix}%`);
  if (refErr) {
    return NextResponse.json({ error: refErr.message }, { status: 500 });
  }
  let nextNumber = 1;
  for (const q of yearQuotes ?? []) {
    const match = /-(\d+)$/.exec(q.ref ?? "");
    if (match) {
      const n = parseInt(match[1], 10);
      if (!Number.isNaN(n) && n >= nextNumber) nextNumber = n + 1;
    }
  }

  let newQuote: { id: string; ref: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidateRef = `${refPrefix}${String(nextNumber).padStart(4, "0")}`;
    const payload = {
      ...carryOver,
      ref: candidateRef,
      status: "draft",
      sent_at: null,
      sent_to_email: null,
      response_token: null,
      accepted_at: null,
      declined_at: null,
      pp1_paid: false,
      pp2_paid: false,
      pp1_paid_at: null,
      pp2_paid_at: null,
      auto_invoice_attempted_at: null,
      auto_invoice_error: null,
      followup_sent_at: null,
      followup_count: 0,
      expires_at: null,
      created_by: user.id,
    };

    const { data: inserted, error: insErr } = await supabase
      .from("quotes")
      .insert(payload)
      .select("id, ref")
      .single();

    if (!insErr && inserted) {
      newQuote = inserted as { id: string; ref: string };
      break;
    }
    const isUniqueViolation =
      insErr?.code === "23505" ||
      (insErr?.message ?? "").toLowerCase().includes("duplicate key");
    if (!isUniqueViolation) {
      return NextResponse.json(
        { error: insErr?.message ?? "Insert failed" },
        { status: 500 },
      );
    }
    nextNumber += 1;
  }

  if (!newQuote) {
    return NextResponse.json(
      { error: "Could not allocate a unique quote ref after 5 attempts" },
      { status: 500 },
    );
  }

  // Copy line items.
  const { data: lineItems } = await supabase
    .from("quote_line_items")
    .select("*")
    .eq("quote_id", id);
  if (lineItems && lineItems.length > 0) {
    const cloneLines = lineItems.map((li: Record<string, unknown>) => {
      const { id: _liId, created_at: _liCAt, quote_id: _liQId, ...rest } = li;
      return { ...rest, quote_id: newQuote!.id };
    });
    const { error: liErr } = await supabase
      .from("quote_line_items")
      .insert(cloneLines);
    if (liErr) {
      // Best-effort rollback so we don't leave a half-cloned quote behind.
      await supabase.from("quotes").delete().eq("id", newQuote.id);
      return NextResponse.json(
        { error: `Line items copy failed: ${liErr.message}` },
        { status: 500 },
      );
    }
  }

  // Copy extras (freight / travel / sundries / electrician).
  const { data: extras } = await supabase
    .from("quote_extras")
    .select("*")
    .eq("quote_id", id);
  if (extras && extras.length > 0) {
    const cloneExtras = extras.map((e: Record<string, unknown>) => {
      const { id: _eId, created_at: _eCAt, quote_id: _eQId, ...rest } = e;
      return { ...rest, quote_id: newQuote!.id };
    });
    const { error: exErr } = await supabase
      .from("quote_extras")
      .insert(cloneExtras);
    if (exErr) {
      await supabase
        .from("quote_line_items")
        .delete()
        .eq("quote_id", newQuote.id);
      await supabase.from("quotes").delete().eq("id", newQuote.id);
      return NextResponse.json(
        { error: `Extras copy failed: ${exErr.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ id: newQuote.id, ref: newQuote.ref });
}
