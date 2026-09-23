"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

// Small client helpers shared by the Finance pages: a POST button and a
// confirm-then-POST button. All routes 404 for non-viewers.

export function usePost() {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function post(url: string, body: unknown, key: string, okMessage?: string): Promise<Record<string, unknown> | null> {
    setBusy(key);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) { toast(String(json.error ?? `Failed (${res.status})`), "error"); return null; }
      if (okMessage) toast(okMessage);
      router.refresh();
      return json;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Request failed", "error");
      return null;
    } finally {
      setBusy(null);
    }
  }
  return { post, busy };
}

export function ActionButton({ url, body, label, busyLabel, okMessage, confirm, variant = "secondary", onDone }: {
  url: string; body: unknown; label: string; busyLabel?: string; okMessage?: string; confirm?: string;
  variant?: "primary" | "secondary" | "danger"; onDone?: (json: Record<string, unknown>) => void;
}) {
  const { post, busy } = usePost();
  const key = `${url}:${JSON.stringify(body)}`;
  const cls = variant === "primary"
    ? "bg-primary text-primary-foreground hover:bg-primary/90"
    : variant === "danger"
      ? "border border-red-500/40 text-red-400 hover:bg-red-500/10"
      : "border border-border hover:bg-accent";
  return (
    <button
      type="button"
      disabled={busy === key}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        const json = await post(url, body, key, okMessage);
        if (json && onDone) onDone(json);
      }}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${cls}`}
    >
      {busy === key ? (busyLabel ?? "Working…") : label}
    </button>
  );
}

export const money = (cents: number | null | undefined) => ((cents ?? 0) / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
