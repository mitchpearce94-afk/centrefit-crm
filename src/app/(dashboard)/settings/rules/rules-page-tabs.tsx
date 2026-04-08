"use client";

import { useState } from "react";

const TABS = [
  { id: "dependency", label: "Dependency Rules" },
  { id: "labour", label: "Labour Timings" },
] as const;

export function RulesPageTabs({
  dependencyTab,
  labourTab,
}: {
  dependencyTab: React.ReactNode;
  labourTab: React.ReactNode;
}) {
  const [active, setActive] = useState<string>("dependency");

  return (
    <>
      <div className="flex gap-1 border-b border-border mb-5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              active === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {active === "dependency" && dependencyTab}
      {active === "labour" && labourTab}
    </>
  );
}
