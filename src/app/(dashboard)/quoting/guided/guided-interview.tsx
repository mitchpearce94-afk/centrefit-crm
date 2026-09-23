"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { INTERVIEW, SITE_QUESTIONS, GUIDED_STORAGE_KEY, interviewToQuote, type InterviewAnswers, type Question } from "@/lib/quote-engine/interview";

interface Template { id: string; name: string; slug: string; is_default: boolean | null }

export function GuidedInterview({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState<string>(templates.find((t) => t.is_default)?.id ?? templates[0]?.id ?? "");
  const [systems, setSystems] = useState<string[]>([]);
  const [answers, setAnswers] = useState<InterviewAnswers>({});
  const [stage, setStage] = useState<"pick" | "questions" | "site">("pick");
  const chosen = useMemo(() => INTERVIEW.filter((s) => systems.includes(s.id)), [systems]);
  const set = (id: string, v: number | boolean | string) => setAnswers((a) => ({ ...a, [id]: v }));
  const visible = (q: Question) => !q.showIf || Boolean(answers[q.showIf]);

  const field = "w-28 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-right";
  const Q = ({ q }: { q: Question }) => {
    if (!visible(q)) return null;
    const v = answers[q.id];
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-t-0">
        <div className="min-w-0"><div className="text-sm">{q.prompt}</div>{q.help ? <div className="text-xs text-muted-foreground">{q.help}</div> : null}</div>
        {q.type === "number" ? <input type="number" min={0} inputMode="numeric" value={v === undefined ? "" : String(v)} onChange={(e) => set(q.id, e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))} className={field} placeholder="0" />
          : q.type === "yesno" ? <div className="flex overflow-hidden rounded-md border border-border text-sm">{[["Yes", true], ["No", false]].map(([l, b]) => <button key={String(l)} type="button" onClick={() => set(q.id, b as boolean)} className={`px-3 py-1.5 ${v === b ? "bg-primary/15 text-primary" : "hover:bg-accent"}`}>{l}</button>)}</div>
          : <select value={String(v ?? "")} onChange={(e) => set(q.id, e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">{q.choices?.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>}
      </div>
    );
  };

  function build() {
    const result = interviewToQuote(systems, answers);
    sessionStorage.setItem(GUIDED_STORAGE_KEY, JSON.stringify({ ...result, templateId, at: new Date().toISOString() }));
    router.push("/quoting/new?guided=1");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Which franchise / template?</label>
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="mt-1 w-full max-w-sm rounded-md border border-border bg-background px-2 py-1.5 text-sm">{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <p className="mt-1 text-xs text-muted-foreground">The template picks which product fills each role and who supplies what — never whether a part is included.</p>
      </div>

      {stage === "pick" ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium">What are we quoting?</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {INTERVIEW.map((s) => { const on = systems.includes(s.id); return (
              <button key={s.id} type="button" onClick={() => setSystems((x) => on ? x.filter((i) => i !== s.id) : [...x, s.id])} className={`rounded-lg border p-3 text-left transition-colors ${on ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`}>
                <div className="text-sm font-medium">{s.label}</div><div className="text-xs text-muted-foreground">{s.blurb}</div>
              </button>); })}
          </div>
          <div className="mt-4 flex justify-end"><button type="button" disabled={!systems.length} onClick={() => setStage("questions")} className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Next</button></div>
        </div>
      ) : null}

      {stage === "questions" ? (
        <div className="space-y-4">
          {chosen.map((s) => (
            <div key={s.id} className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold">{s.label}</p>
              <div className="mt-1">{s.questions.map((q) => <Q key={q.id} q={q} />)}</div>
            </div>
          ))}
          <div className="flex justify-between"><button type="button" onClick={() => setStage("pick")} className="rounded-md border border-border px-4 py-2 text-sm">Back</button><button type="button" onClick={() => setStage("site")} className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">Next — the site</button></div>
        </div>
      ) : null}

      {stage === "site" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-semibold">The site</p>
            <div className="mt-1">{SITE_QUESTIONS.map((q) => <Q key={q.id} q={q} />)}</div>
          </div>
          <div className="flex justify-between"><button type="button" onClick={() => setStage("questions")} className="rounded-md border border-border px-4 py-2 text-sm">Back</button><button type="button" onClick={build} className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">Build the quote</button></div>
        </div>
      ) : null}
    </div>
  );
}
