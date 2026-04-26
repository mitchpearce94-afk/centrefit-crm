import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#6b7280",
  sent: "#3b82f6",
  accepted: "#22c55e",
  declined: "#ef4444",
  expired: "#f59e0b",
};

export default async function QuotingPage() {
  const supabase = await createClient();

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
  const allQuotes = (quotes ?? []).map((q: any) => {
    const isExpired = q.expires_at && new Date(q.expires_at) < now && (q.status === "draft" || q.status === "sent");
    return { ...q, displayStatus: isExpired ? "expired" : q.status };
  });

  const draftCount = allQuotes.filter((q) => q.displayStatus === "draft").length;
  const sentCount = allQuotes.filter((q) => q.displayStatus === "sent").length;
  const acceptedCount = allQuotes.filter((q) => q.displayStatus === "accepted").length;
  const expiredCount = allQuotes.filter((q) => q.displayStatus === "expired").length;

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
            {allQuotes.map((quote: any) => {
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
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium capitalize"
                      style={{ backgroundColor: `${colour}20`, color: colour }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colour }} />
                      {quote.displayStatus}
                    </span>
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
            {allQuotes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  No quotes yet.{" "}
                  <Link href="/quoting/new" className="text-primary hover:underline">
                    Create your first quote
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
