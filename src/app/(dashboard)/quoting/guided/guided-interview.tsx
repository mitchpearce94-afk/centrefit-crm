"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { INTERVIEW, SITE_QUESTIONS, GUIDED_STORAGE_KEY, interviewToQuote, type InterviewAnswers, type Question } from "@/lib/quote-engine/interview";

interface Template { id: string; name: string; slug: string; is_default: boolean | null }

// Answers are kept as typed text while editing (a number input's spinner and
// eager parsing fought the keyboard — Mitchell 23 Sep); they're parsed once on Build.
type Draft = Record<string, string | boolean>;

const FIELD = "w-28 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-right tabular-nums";

// Hoisted: defining this inside the parent remounted every input on each
// keystroke and dropped focus after one character.
function QuestionRow({ q, value, onChange }: { q: Question; value: string | boolean | undefined; onChange: (v: string | boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-t-0">
      <div className="min-w-0"><div className="text-sm">{q.prompt}</div>{q.help ? <div className="text-xs text-muted-foreground">{q.help}</div> : null}</div>
      {q.type === "number" ? (
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
          onFocus={(e) => e.target.select()}
          className={FIELD}
          placeholder="0"
        />
      ) : q.type === "yesno" ? (
        <div className="flex overflow-hidden rounded-md border border-border text-sm">
          {([["Yes", true], ["No", false]] as const).map(([label, b]) => (
            <button key={label} type="button" onClick={() => onChange(b)} className={`px-3 py-1.5 ${value === b ? "bg-primary/15 text-primary" : "hover:bg-accent"}`}>{label}</button>
          ))}
        </div>
      ) : (
        <select value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
          {q.choices?.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      )}
    </div>
  );
}

function toAnswers(draft: Draft): InterviewAnswers {
  const out: InterviewAnswers = {};
  for (const [k, v] of Object.entries(draft)) {
    if (typeof v === "boolean") out[k] = v;
    else if (v !== "") out[k] = /^\d+$/.test(v) ? Number(v) : v;
  }
  return out;
}

export function GuidedInterview({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState<string>(templates.find((t) => t.is_default)?.id ?? templates[0]?.id ?? "");
  const [systems, setSystems] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [stage, setStage] = useState<"pick" | "questions" | "site">("pick");
  const chosen = useMemo(() => INTERVIEW.filter((s) => systems.includes(s.id)), [systems]);
  // Interstate = Yes defaults both electrician toggles on (Mitchell, 23 Sep:
  // interstate means the electrician does rough-in and fit-off, we quote
  // their cost at 2x). Either can still be flipped off.
  const set = (id: string, v: string | boolean) => setDraft((d) => {
    const next = { ...d, [id]: v };
    if (id === "isInterstate" && v === true) {
      if (d.elecDoingRoughIn === undefined) next.elecDoingRoughIn = true;
      if (d.elecDoingFitOff === undefined) next.elecDoingFitOff = true;
    }
    return next;
  });
  const truthy = (id: string) => { const v = draft[id]; return typeof v === "boolean" ? v : !!v && v !== "0"; };
  const visible = (q: Question) => !q.showIf || truthy(q.showIf);

  function build() {
    const result = interviewToQuote(systems, toAnswers(draft));
    try {
      sessionStorage.setItem(GUIDED_STORAGE_KEY, JSON.stringify({ ...result, templateId, at: new Date().toISOString() }));
    } catch {
      return;
    }
    router.push("/quoting/new?guided=1");
  }

  const rows = (qs: Question[]) => qs.filter(visible).map((q) => <QuestionRow key={q.id} q={q} value={draft[q.id]} onChange={(v) => set(q.id, v)} />);

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
              <div className="mt-1">{rows(s.questions)}</div>
            </div>
          ))}
          <div className="flex justify-between"><button type="button" onClick={() => setStage("pick")} className="rounded-md border border-border px-4 py-2 text-sm">Back</button><button type="button" onClick={() => setStage("site")} className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">Next — the site</button></div>
        </div>
      ) : null}

      {stage === "site" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-semibold">The site</p>
            <div className="mt-1">{rows(SITE_QUESTIONS)}</div>
          </div>
          <div className="flex justify-between"><button type="button" onClick={() => setStage("questions")} className="rounded-md border border-border px-4 py-2 text-sm">Back</button><button type="button" onClick={build} className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">Build the quote</button></div>
        </div>
      ) : null}
    </div>
  );
}
