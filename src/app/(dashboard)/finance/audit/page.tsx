import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// The accountant's trail (docs/finance-CONTEXT.md D11).
export default async function FinanceAuditPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase.from("finance_agent_actions").select("id, at, actor, action, entity, entity_id, before, after, rule, note").order("at", { ascending: false }).limit(300);
  if (!rows?.length) return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing yet.</div>;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-accent/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Action</th><th className="px-3 py-2 hidden md:table-cell">Detail</th><th className="px-3 py-2 hidden sm:table-cell">Rule</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">{new Date(r.at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane", dateStyle: "short", timeStyle: "short" })}</td>
              <td className="px-3 py-2 text-xs">{r.actor}</td>
              <td className="px-3 py-2"><span className="font-medium">{r.action}</span>{r.entity ? <span className="ml-1 text-xs text-muted-foreground">{r.entity}{r.entity_id ? ` ${String(r.entity_id).slice(0, 8)}` : ""}</span> : null}</td>
              <td className="px-3 py-2 hidden md:table-cell"><pre className="max-w-xl whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">{r.after ? JSON.stringify(r.after).slice(0, 400) : r.note ?? ""}</pre></td>
              <td className="px-3 py-2 hidden sm:table-cell text-xs text-muted-foreground">{r.rule ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
