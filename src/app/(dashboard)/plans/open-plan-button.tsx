"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePlanStore } from "@/store/planStore";

export function OpenPlanButton({ cfpUrl }: { cfpUrl: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleOpen = async () => {
    setLoading(true);
    try {
      const res = await fetch(cfpUrl);
      const text = await res.text();
      usePlanStore.getState().loadProject(text);
      router.push("/plans/new");
    } catch (err) {
      console.error("Failed to load plan:", err);
      alert("Failed to load plan. Please try again.");
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleOpen}
      disabled={loading}
      className="px-2.5 py-1.5 bg-primary/10 text-primary hover:bg-primary/20 rounded text-xs font-medium transition-colors disabled:opacity-50"
    >
      {loading ? "Loading..." : "Open in Editor"}
    </button>
  );
}
