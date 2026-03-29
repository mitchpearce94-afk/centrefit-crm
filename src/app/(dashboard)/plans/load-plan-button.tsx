"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { usePlanStore } from "@/store/planStore";

export function LoadPlanButton({ label }: { label?: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      if (!ev.target?.result) return;
      usePlanStore.getState().loadProject(ev.target.result as string);
      router.push("/plans/new");
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".cfp,.json"
        className="hidden"
        onChange={handleFile}
      />
      <button
        onClick={() => fileRef.current?.click()}
        className="px-4 py-2 bg-card border border-border text-foreground rounded-md text-sm font-medium hover:bg-accent transition-colors"
      >
        {label || "Load .cfp"}
      </button>
    </>
  );
}
