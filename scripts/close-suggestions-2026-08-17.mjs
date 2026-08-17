// One-off: close the 2026-08-17 suggestion batch with verification notes.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()];
    }),
);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLOSURES = [
  {
    id: "fbfa8c8d-8abc-4151-ab6e-c791f719d57a",
    notes: "Fixed 2026-08-17 (743f1bd): searching inside the Active view was deliberately dropping the status filter ('global scope while searching'); it now excludes Complete/Cancelled/Invoice Sent in the query itself (so the 100-row cap can't hide active matches either). The All tab keeps global search for old jobs. Closed by Cortex.",
  },
  {
    id: "8f91e3cc-fc26-49a7-8660-17f92241568f",
    notes: "Fixed 2026-08-17 (743f1bd): the vault unlock form's autoFocus was tripping the hide-nav-while-typing behaviour without a keyboard ever opening (and unmounted inputs jammed it hidden). The keyboard detector now requires a real viewport shrink and self-heals, and the vault has a mobile Back to CRM link as a permanent escape hatch. Closed by Cortex.",
  },
  {
    id: "202b4462-cb46-4b09-971c-35aee3b08b76",
    notes: "Fixed 2026-08-17 (743f1bd): assigning staff from the job only wrote job_staff — the scheduler reads schedule_entries, and the job side captured no date, so no tile could exist. The Staff tab now has an optional date/time row; pick a date, tap a name, and the tile is created (with job_scheduled status transition). No date = tag-only, same as before. Closed by Cortex.",
  },
  {
    id: "0cd85745-599c-4a1d-86fe-09b91246726b",
    notes: "Built 2026-08-17 (743f1bd): note photos now open in a fullscreen viewer with left/right swipe on mobile, arrows + keyboard on desktop, and a position counter — no more one-tab-per-photo. Videos keep their inline player; documents still open in a tab. Closed by Cortex.",
  },
  {
    id: "0448a1e8-9673-43ac-b4b0-4b235cdce887",
    notes: "Already built — the recurring wizard's 'Save as draft' mode (shipped 2026-07-28) holds the plan in draft with the signup email unsent, and the plan page's Send button pulls the trigger when the job's ready. Mitchell confirmed 2026-08-17 this covers the need. Closed by Cortex.",
  },
];

for (const c of CLOSURES) {
  const { error } = await svc
    .from("staff_suggestions")
    .update({ status: "done", notes: c.notes, updated_at: new Date().toISOString() })
    .eq("id", c.id);
  console.log(c.id.slice(0, 8), error ? `ERROR: ${error.message}` : "closed");
}
