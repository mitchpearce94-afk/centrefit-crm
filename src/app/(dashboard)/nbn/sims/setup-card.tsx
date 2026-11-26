export function JasperSetupCard() {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
      <h2 className="text-sm font-semibold">M2M One SIMs — not connected yet</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        The CRM talks to Jasper Control Centre (the platform behind M2M One) with a per-user REST key.
        Once the two env vars below are set in Vercel, this tab lists every SIM with status, plan, usage and the
        site it belongs to.
      </p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs text-foreground/90">
        <li>
          Log in to{" "}
          <a href="https://m2mone.jasperwireless.com" target="_blank" className="underline">
            m2mone.jasperwireless.com
          </a>{" "}
          with Centrefit&rsquo;s Control Centre login.
        </li>
        <li>Click your username (top right) → User Profile → <b>Generate REST API Key</b>, wait, then <b>Show REST API Key</b>.</li>
        <li>
          In Vercel → centrefit-crm → Environment Variables (Production) add{" "}
          <code className="font-mono">JASPER_USERNAME</code> = that login and{" "}
          <code className="font-mono">JASPER_REST_API_KEY</code> = the key, then redeploy.
        </li>
      </ol>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Reference: M2M One &ldquo;API Integration&rdquo; PDF (Liam Velkos, 26 Nov 2026) and{" "}
        <code className="font-mono">docs/sims-jasper-CONTEXT.md</code>.
      </p>
    </div>
  );
}
