import { requireFinanceViewerOrNotFound } from "@/lib/finance/access";
import { FinanceTabs } from "./finance-tabs";

// Finance — Mitchell-only (docs/finance-CONTEXT.md D1). 404 for everyone else.
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requireFinanceViewerOrNotFound();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Finance</h1>
          <p className="text-sm text-muted-foreground">The agent prepares. You approve. Nothing here releases money.</p>
        </div>
      </div>
      <FinanceTabs />
      <div className="pt-4">{children}</div>
    </div>
  );
}
