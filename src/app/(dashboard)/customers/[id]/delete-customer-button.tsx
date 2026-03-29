"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

export function DeleteCustomerButton({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();

  async function handleDelete() {
    const { error } = await supabase
      .from("customers")
      .update({ is_active: false })
      .eq("id", customerId);

    if (error) {
      toast(error.message, "error");
    } else {
      router.push("/customers");
      router.refresh();
    }
  }

  if (confirming) {
    return (
      <div className="flex gap-2">
        <button
          onClick={handleDelete}
          className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
        >
          Archive
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
      title={`Archive ${customerName}`}
    >
      Archive
    </button>
  );
}
