"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { SignaturePad } from "@/components/ui/signature-pad";
import { SWMS_TASK_GROUPS } from "@/lib/swms/spec";

/**
 * SWMS generation modal (Phase C). Generate → download PDF only — no
 * customer send flow. Staff signatures auto-apply from their stored
 * profiles; anyone selected without a stored signature gets a blank
 * sign-on line for the day of briefing. The viewer can draw and save
 * their own signature inline (one time) — staff RLS blocks client-side
 * self-edit, so it saves via /api/staff/signature.
 */

export interface SwmsJobOption {
  id: string;
  number: string;
  reference: string | null;
}

export interface SwmsStaffOption {
  id: string;
  display_name: string | null;
  role: string | null;
  has_signature: boolean;
}

export interface SwmsPcbuDefaults {
  name: string;
  abn: string;
  address: string;
  keyReps: string;
}

interface SubbieRow {
  name: string;
  company: string;
  licences: string;
}

export function SwmsGenerateModal({
  siteId,
  jobs,
  staffList,
  viewerId,
  defaultPcbu,
  onClose,
}: {
  siteId: string;
  jobs: SwmsJobOption[];
  staffList: SwmsStaffOption[];
  viewerId: string;
  defaultPcbu: SwmsPcbuDefaults;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [jobId, setJobId] = useState<string>(jobs[0]?.id ?? "");
  // The PCBU is usually the BUILDER, not the site owner (Mitchell's
  // feedback: 9 times out of 10 the builder requires the SWMS) — owner
  // details prefill as the fallback, everything editable.
  const [pcbu, setPcbu] = useState<SwmsPcbuDefaults>(defaultPcbu);
  const [groups, setGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(SWMS_TASK_GROUPS.map((g) => [g.key, true])),
  );
  const [staffIds, setStaffIds] = useState<Record<string, boolean>>(
    Object.fromEntries(staffList.map((s) => [s.id, s.id === viewerId])),
  );
  const [approverId, setApproverId] = useState(viewerId);
  const [workDate, setWorkDate] = useState("");
  const [hospital, setHospital] = useState("");
  const [subbies, setSubbies] = useState<SubbieRow[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [savingSig, setSavingSig] = useState(false);
  const [generating, setGenerating] = useState(false);

  const viewer = staffList.find((s) => s.id === viewerId);
  const [viewerHasSignature, setViewerHasSignature] = useState(viewer?.has_signature ?? false);

  async function saveSignature() {
    if (!signature) {
      toast("Draw your signature first", "error");
      return;
    }
    setSavingSig(true);
    try {
      const res = await fetch("/api/staff/signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Save failed");
      setViewerHasSignature(true);
      toast("Signature saved to your profile — it now auto-applies on every SWMS");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSavingSig(false);
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/swms/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: jobId || undefined,
          taskGroupKeys: Object.entries(groups).filter(([, on]) => on).map(([k]) => k),
          staffIds: Object.entries(staffIds).filter(([, on]) => on).map(([k]) => k),
          subcontractors: subbies,
          proposedWorkDate: workDate || undefined,
          hospitalOverride: hospital || undefined,
          approverStaffId: approverId,
          pcbu,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Generate failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "SWMS.pdf");
      a.click();
      URL.revokeObjectURL(url);
      toast("SWMS generated — copy saved under the SWMS heading");
      onClose();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Generate failed", "error");
    } finally {
      setGenerating(false);
    }
  }

  return (
    // No backdrop-click dismiss (Mitchell's feedback) — Cancel only.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="surface-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-5">
        <h3 className="text-sm font-semibold">Generate SWMS</h3>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          Installation &amp; Commissioning of Security, Access Control and CCTV Infrastructure — the master
          template auto-filled for this site. Download only; email it to the builder yourself.
        </p>

        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-border p-3">
            <span className="text-[11px] font-semibold text-foreground">Who requires this SWMS (PCBU / client)</span>
            <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
              Usually the builder — replace the pre-filled owner details with the builder&apos;s.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block col-span-2">
                <span className="text-[10px] font-medium text-muted-foreground">Company name</span>
                <input
                  className="mt-0.5 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                  value={pcbu.name}
                  onChange={(e) => setPcbu({ ...pcbu, name: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-medium text-muted-foreground">ABN</span>
                <input
                  className="mt-0.5 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                  value={pcbu.abn}
                  onChange={(e) => setPcbu({ ...pcbu, abn: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-medium text-muted-foreground">Key representative(s)</span>
                <input
                  className="mt-0.5 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                  value={pcbu.keyReps}
                  onChange={(e) => setPcbu({ ...pcbu, keyReps: e.target.value })}
                />
              </label>
              <label className="block col-span-2">
                <span className="text-[10px] font-medium text-muted-foreground">Company address</span>
                <input
                  className="mt-0.5 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                  value={pcbu.address}
                  onChange={(e) => setPcbu({ ...pcbu, address: e.target.value })}
                />
              </label>
            </div>
          </div>

          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">Job (permit number + work dates)</span>
            <select
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
            >
              <option value="">No job — fill dates manually</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.number}{j.reference ? ` — ${j.reference}` : ""}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="text-[11px] font-medium text-muted-foreground">Task groups (untick anything not applicable, e.g. no EWP)</span>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {SWMS_TASK_GROUPS.map((g) => (
                <label key={g.key} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={groups[g.key]}
                    onChange={(e) => setGroups({ ...groups, [g.key]: e.target.checked })}
                  />
                  <span className="capitalize">{g.title.toLowerCase()}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[11px] font-medium text-muted-foreground">Staff on the sign-on register</span>
            <div className="mt-1 space-y-1">
              {staffList.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={staffIds[s.id] ?? false}
                    onChange={(e) => setStaffIds({ ...staffIds, [s.id]: e.target.checked })}
                  />
                  {s.display_name}
                  <span className={s.has_signature || (s.id === viewerId && viewerHasSignature) ? "text-emerald-400 text-[10px]" : "text-amber-400 text-[10px]"}>
                    {s.has_signature || (s.id === viewerId && viewerHasSignature) ? "✓ signature on file" : "no signature — blank line"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {!viewerHasSignature && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-[11px] text-amber-400 font-medium mb-2">
                You haven&apos;t stored your signature yet — draw it once and it auto-applies to every SWMS.
              </p>
              <div className="rounded-md bg-white p-1">
                <SignaturePad onChange={setSignature} height={110} />
              </div>
              <button
                type="button"
                onClick={saveSignature}
                disabled={savingSig || !signature}
                className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {savingSig ? "Saving…" : "Save my signature"}
              </button>
            </div>
          )}

          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">Approver</span>
            <select
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={approverId}
              onChange={(e) => setApproverId(e.target.value)}
            >
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.display_name}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-muted-foreground">Proposed work date (blank = from job)</span>
              <input
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                placeholder="e.g. July – September 2026"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-muted-foreground">Nearest hospital (blank = auto)</span>
              <input
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={hospital}
                onChange={(e) => setHospital(e.target.value)}
                placeholder="auto from site address"
              />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">Sub-contractors (optional)</span>
              <button
                type="button"
                onClick={() => setSubbies([...subbies, { name: "", company: "", licences: "" }])}
                className="text-[11px] text-primary hover:underline"
              >
                + Add row
              </button>
            </div>
            {subbies.map((row, i) => (
              <div key={i} className="mt-1 grid grid-cols-3 gap-1.5">
                {(["name", "company", "licences"] as const).map((field) => (
                  <input
                    key={field}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    placeholder={field === "licences" ? "Licences (White Card, EWP…)" : field[0].toUpperCase() + field.slice(1)}
                    value={row[field]}
                    onChange={(e) => {
                      const next = [...subbies];
                      next[i] = { ...row, [field]: e.target.value };
                      setSubbies(next);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={generating}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {generating ? "Generating…" : "Generate & Download"}
          </button>
        </div>
      </div>
    </div>
  );
}
