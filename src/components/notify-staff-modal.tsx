"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

interface StaffOption {
  id: string;
  display_name: string;
  initials: string;
  colour: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  refType: "plan" | "quote" | "invoice" | "job" | "recurring_plan";
  refId: string;
  /** Short context line shown in the modal header (e.g. "CF-2026-0042 — Snap Lawnton"). */
  refLabel: string;
  /** Where the notification's bell-click should land the recipient. */
  href: string;
}

export function NotifyStaffModal({ open, onClose, refType, refId, refLabel, href }: Props) {
  const supabase = createClient();
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setMessage("");
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMe(user?.id ?? null);
      const { data } = await supabase
        .from("staff")
        .select("id, display_name, initials, colour")
        .eq("is_active", true)
        .order("display_name");
      setStaff((data ?? []) as StaffOption[]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send() {
    if (selected.size === 0) {
      toast("Pick at least one teammate to notify", "error");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/notifications/staff-mention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffIds: Array.from(selected),
          refType,
          refId,
          refLabel,
          href,
          message: message.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      toast(`Notified ${selected.size} teammate${selected.size === 1 ? "" : "s"}`);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;
  const eligible = staff.filter((s) => s.id !== me);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !sending && onClose()} />
      <div className="relative w-full max-w-md rounded-lg border border-border bg-card-elevated p-5 shadow-2xl">
        <h3 className="text-base font-semibold">Notify teammates</h3>
        <p className="mt-1 text-xs text-muted-foreground">{refLabel}</p>

        <div className="mt-4 max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {eligible.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">No active teammates to notify.</div>
          ) : (
            eligible.map((s) => {
              const checked = selected.has(s.id);
              return (
                <label
                  key={s.id}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent transition-colors ${checked ? "bg-accent/40" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(s.id)}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: s.colour ?? "#64748b" }}
                  >
                    {s.initials}
                  </span>
                  <span className="text-sm text-foreground">{s.display_name}</span>
                </label>
              );
            })
          )}
        </div>

        <label className="mt-4 block">
          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Message (optional)</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Take a look at this — need pricing by Friday"
            rows={2}
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || selected.size === 0}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {sending ? "Sending…" : `Notify ${selected.size || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
