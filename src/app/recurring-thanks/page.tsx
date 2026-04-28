import { CompleteFlow } from "./complete-flow";

/**
 * Public landing page after a customer completes their direct debit setup
 * on the GoCardless-hosted form. They land here from the
 * `success_redirect_url` we set when creating the redirect flow, with
 * `?redirect_flow_id=...` appended by GC.
 *
 * The client component calls our /api/recurring-plans/complete endpoint
 * to finalise the GC redirect flow and persist the mandate IDs. The page
 * shows a loading state during that, then a success or error state.
 *
 * No auth — must be in the public-paths list in middleware.
 */
export default async function RecurringThanksPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_flow_id?: string }>;
}) {
  const params = await searchParams;
  const redirectFlowId = params.redirect_flow_id ?? null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md text-center space-y-4">
        <CompleteFlow redirectFlowId={redirectFlowId} />
      </div>
    </div>
  );
}
