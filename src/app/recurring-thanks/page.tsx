/**
 * Public landing page after a customer signs their direct debit on the
 * GoCardless-hosted Billing Request flow. They land here from the
 * `redirect_uri` we set on the BR flow.
 *
 * No completion call is needed — Billing Requests fulfil themselves when
 * the customer signs, and we capture the customer + mandate IDs via the
 * GC webhook on `billing_requests.fulfilled`.
 */
export default function RecurringThanksPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-emerald-500"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Direct debit confirmed</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Thanks — we've got your direct debit details. Your account will be
          activated in 1–3 business days once the bank verifies the mandate.
          You'll receive an email confirmation when your first invoice is
          issued.
        </p>
        <p className="text-xs text-muted-foreground pt-4">
          Questions? Reply to your setup email or contact{" "}
          <a href="mailto:accounts@centrefit.com.au" className="underline">
            accounts@centrefit.com.au
          </a>
        </p>
      </div>
    </div>
  );
}
