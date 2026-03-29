"use client";

import { useState } from "react";

interface QuoteDetailTabsProps {
  internalView: React.ReactNode;
  customerView: React.ReactNode;
}

export function QuoteDetailTabs({ internalView, customerView }: QuoteDetailTabsProps) {
  const [active, setActive] = useState<"internal" | "customer">("internal");

  return (
    <div>
      <div className="flex gap-0 border-b border-border overflow-x-auto print:hidden">
        <button
          onClick={() => setActive("internal")}
          className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            active === "internal"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
          }`}
        >
          Internal View
        </button>
        <button
          onClick={() => setActive("customer")}
          className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            active === "customer"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
          }`}
        >
          Customer Quote
        </button>
      </div>
      <div className="pt-5 print:hidden">
        {active === "internal" ? internalView : customerView}
      </div>
    </div>
  );
}

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
    >
      Print
    </button>
  );
}
