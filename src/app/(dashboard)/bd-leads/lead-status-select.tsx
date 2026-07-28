"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

const STATUSES = ["new", "reviewing", "contacted", "quoted", "won", "dead", "ignored"] as const;

export function LeadStatusSelect({ leadId, status }: { leadId: string; status: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    setBusy(true);
    const { error, data } = await supabase
      .from("bd_leads")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", leadId)
      .select("id");
    setBusy(false);
    if (error || !data || data.length === 0) {
      toast(error?.message ?? "Couldn't update lead", "error");
      return;
    }
    router.refresh();
  }

  return (
    <select
      value={status}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      className="rounded-md border border-border bg-input px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s.charAt(0).toUpperCase() + s.slice(1)}
        </option>
      ))}
    </select>
  );
}
