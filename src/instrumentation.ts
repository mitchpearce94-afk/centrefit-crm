/**
 * Next.js instrumentation hook — runs once when the server boots.
 *
 * We use it to pin Node's runtime timezone to Australia/Brisbane so that
 * server-rendered `toLocaleString("en-AU")` calls actually produce
 * Brisbane times instead of UTC. Vercel's serverless runtime defaults to
 * UTC, and Vercel reserves the `TZ` env-var name so we can't set it via
 * the dashboard. Setting `process.env.TZ` here works because libc's
 * `tzset()` picks it up before the first `Date.prototype.toLocaleString`
 * call in any request handler.
 *
 * Edge runtime doesn't expose process.env.TZ, so we only set it on Node.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.env.TZ = "Australia/Brisbane";
  }
}
