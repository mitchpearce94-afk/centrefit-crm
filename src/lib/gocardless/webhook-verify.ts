import "server-only";
import crypto from "node:crypto";

/**
 * GoCardless webhook signature verification.
 *
 * GC signs each webhook body with HMAC-SHA256 and the secret you set when
 * configuring the webhook endpoint in their dashboard. The signature lives
 * in the `Webhook-Signature` request header as a hex digest.
 *
 * Spec: https://developer.gocardless.com/api-reference/#core-endpoints-events
 */
export function verifyGoCardlessSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  // Length-equal timing-safe comparison
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
