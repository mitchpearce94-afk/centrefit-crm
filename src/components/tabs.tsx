"use client";

import { useState } from "react";

interface Tab {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  defaultTab,
  children,
}: {
  tabs: Tab[];
  defaultTab?: string;
  children: (activeTab: string) => React.ReactNode;
}) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id ?? "");

  return (
    <div>
      {/* Mobile: native select. Browser's built-in picker beats every custom
          dropdown on phones — full-height, accessible, OS-native scroll.
          Hidden on sm+ where the horizontal strip below takes over. */}
      <div className="sm:hidden mb-3">
        <select
          value={active}
          onChange={(e) => setActive(e.target.value)}
          className="block w-full rounded-md border border-border bg-input px-3 py-2.5 text-base font-medium text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
              {tab.count !== undefined && tab.count > 0 ? ` (${tab.count})` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop: horizontal tab strip — unchanged. */}
      <div className="hidden sm:flex gap-0 border-b border-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              active === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="pt-5">{children(active)}</div>
    </div>
  );
}
