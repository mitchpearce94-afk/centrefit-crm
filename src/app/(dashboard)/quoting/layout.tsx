import { requirePermissionOrNotFound } from "@/lib/auth/route-guards";

/**
 * /quoting/* gate. Staff without quoting.view get a 404 (D10 — don't leak
 * the feature exists). Covers /quoting, /quoting/new, /quoting/[id], and
 * /quoting/[id]/edit because Next.js runs this layout for every nested
 * page.
 */
export default async function QuotingLayout({ children }: { children: React.ReactNode }) {
  await requirePermissionOrNotFound("quoting.view");
  return <>{children}</>;
}
