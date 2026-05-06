import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#6b7280",
  sent: "#3b82f6",
  accepted: "#22c55e",
  declined: "#ef4444",
  expired: "#f59e0b",
};

const FOLLOWUP_AGE_DAYS = 7;

export default async function QuotingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;
  const tab = (params.tab ?? "all") as "all" | "followup" | "draft" | "sent" | "accepted" | "expired";

  const { data: quotes, error } = await supabase
    .from("quotes")
    .select("*, customer:customers(id, name)")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="text-destructive">
        Error loading quotes: {error.message}
      </div>
    );
  }

  const now = new Date();
  const followupCutoffMs = now.getTime() - FOLLOWUP_AGE_DAYS * 86_400_000;
  const allQuotes = (quotes ?? []).map((q: any) => {
    const isExpired = q.expires_at && new Date(q.expires_at) < now && (q.status === "draft" || q.status === "sent");
    const sentAtMs = q.sent_at ? new Date(q.sent_at).getTime() : null;
    const needsFollowup =
      q.status === "sent" &&
      sentAtMs !== null &&
      sentAtMs <= followupCutoffMs;
    return { ...q, displayStatus: isExpired ? "expired" : q.status, _needsFollowup: needsFollowup, _sentAtMs: sentAtMs };
  });

  const draftCount = allQuotes.filter((q) => q.displayStatus === "draft").length;
  const sentCount = allQuotes.filter((q) => q.displayStatus === "sent").length;
  const acceptedCount = allQuotes.filter((q) => q.displayStatus === "accepted").length;
  const expiredCount = allQuotes.filter((q) => q.displayStatus === "expired").length;
  const followupCount = allQuotes.filter((q) => q._needsFollowup).length;

  const filtered =
    tab === "followup" ? allQuotes.filter((q) => q._needsFollowup)
    : tab === "draft" ? allQuotes.filter((q) => q.displayStatus === "draft")
    : tab === "sent" ? allQuotes.filter((q) => q.displayStatus === "sent")
    : tab === "accepted" ? allQuotes.filter((q) => q.displayStatus === "accepted")
    : tab === "expired" ? allQuotes.filter((q) => q.displayStatus === "expired")
    : allQuotes;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Quoting</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{allQuotes.length}</span> total quotes
          </p>
        </div>
        <Link
          href="/quoting/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          New Quote
        </Link>
      </div>

      {/* Stats bar */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="surface-card card-hover p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Total</p>
          <p className="num-display num-gradient mt-2 text-2xl font-semibold">{allQuotes.length}</p>
        </div>
        <div className="surface-card card-hover p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Draft</p>
          <p className="num-display mt-2 text-2xl font-semibold" style={{ color: STATUS_COLOURS.draft }}>{draftCount}</p>
        </div>
        <div className="surface-card card-hover p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Sent</p>
          <p className="num-display mt-2 text-2xl font-semibold" style={{ color: STATUS_COLOURS.sent }}>{sentCount}</p>
        </div>
        <div className="surface-card card-hover p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Accepted</p>
          <p className="num-display mt-2 text-2xl font-semibold" style={{ color: STATUS_COLOURS.accepted }}>{acceptedCount}</p>
        </div>
        <div className="surface-card card-hover p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Expired</p>
          <p className="num-display mt-2 text-2xl font-semibold" style={{ color: STATUS_COLOURS.expired }}>{expiredCount}</p>
        </div>
      </div>

      {/* Tab strip */}
      <div className="mt-4 flex flex-wrap items-center gap-1 border-b border-border">
        {[
          { key: "all", label: "All", count: allQuotes.length },
          { key: "followup", label: "Follow-up", count: followupCount, accent: followupCount > 0 },
          { key: "draft", label: "Draft", count: draftCount },
          { key: "sent", label: "Sent", count: sentCount },
          { key: "accepted", label: "Accepted", count: acceptedCount },
          { key: "expired", label: "Expired", count: expiredCount },
        ].map((t) => {
          const active = tab === t.key;
          return (
            <Link
              key={t.key}
              href={t.key === "all" ? "/quoting" : `/quoting?tab=${t.key}`}
              className={`relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    t.accent
                      ? "bg-amber-500/20 text-amber-300"
                      : active
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Quotes table */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ref</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Client</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Site</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden md:table-cell">Expires</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden md:table-cell">Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((quote: any) => {
              const colour = STATUS_COLOURS[quote.displayStatus] ?? "#6b7280";
              const expiresDate = quote.expires_at ? new Date(quote.expires_at) : null;
              const daysLeft = expiresDate ? Math.ceil((expiresDate.getTime() - now.getTime()) / 86400000) : null;
              return (
                <tr
                  key={quote.id}
                  className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/quoting/${quote.id}`}
                      className="font-mono font-medium text-foreground hover:text-primary transition-colors"
                    >
                      {quote.ref}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {quote.customer?.name ?? quote.client_name ?? "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {quote.site_name ?? "\u2014"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium capitalize"
                        style={{ backgroundColor: `${colour}20`, color: colour }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colour }} />
                        {quote.displayStatus}
                      </span>
                      {quote._needsFollowup && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 uppercase tracking-wide">
                          Follow-up
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">
                    {expiresDate ? (
                      <span className={daysLeft !== null && daysLeft <= 7 && daysLeft > 0 ? "text-amber-400" : daysLeft !== null && daysLeft <= 0 ? "text-red-400" : ""}>
                        {daysLeft !== null && daysLeft > 0 ? `${daysLeft}d left` : daysLeft === 0 ? "Today" : quote.displayStatus === "expired" ? "Expired" : "\u2014"}
                      </span>
                    ) : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">
                    {new Date(quote.created_at).toLocaleDateString("en-AU")}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  {tab === "followup"
                    ? "No quotes need a follow-up right now — sent quotes appear here once they pass 7 days without a customer response."
                    : tab === "all"
                    ? <>No quotes yet. <Link href="/quoting/new" className="text-primary hover:underline">Create your first quote</Link></>
                    : `No ${tab} quotes.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
