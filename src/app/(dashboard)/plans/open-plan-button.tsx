"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OpenPlanButton({ cfpUrl, planId }: { cfpUrl: string; planId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleOpen = async () => {
    setLoading(true);
    router.push(`/plans/${planId}`);
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
