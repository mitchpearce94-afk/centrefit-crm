import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Email triage classifier (assistant-CONTEXT.md D6/D7).
 *
 * Tiers:
 *   bill   — genuine supplier bill/invoice payable BY Centrefit → forwarded
 *            to the Xero Bills inbox (the only executing auto-action in V1)
 *   action — needs Mitchell → becomes a My List task with a deep link
 *   fyi    — worth existing, needs nothing
 *   noise  — marketing / automated chatter
 *
 * Safety rule baked into the prompt AND the fallback paths: anything
 * ambiguous downgrades to `action`. A wrongly-flagged email costs Mitchell a
 * glance; a wrong auto-forward costs trust.
 */

export type TriageClass = "bill" | "action" | "fyi" | "noise";

export interface TriageVerdict {
  classification: TriageClass;
  reason: string;
  /** Imperative task title when classification is "action". */
  actionSummary: string | null;
  /** Supplier name when classification is "bill". */
  billSupplier: string | null;
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    classification: { type: "string", enum: ["bill", "action", "fyi", "noise"] },
    reason: { type: "string", description: "One short sentence justifying the classification." },
    action_summary: {
      type: ["string", "null"],
      description: "For 'action' only: imperative task title, max 80 chars, e.g. 'Reply to Sarah re Anytime Carindale camera quote'. Null otherwise.",
    },
    bill_supplier: {
      type: ["string", "null"],
      description: "For 'bill' only: the supplier's name. Null otherwise.",
    },
  },
  required: ["classification", "reason", "action_summary", "bill_supplier"],
  additionalProperties: false,
} as const;

const SYSTEM = `You triage inbound email for Centrefit Group, an Australian security/IT installation company (CCTV, access control, alarms, NBN) run by Mitchell. You classify each email into exactly one tier:

"bill" — a genuine supplier bill or invoice that Centrefit must PAY, from a supplier (e.g. Seadan, wholesalers, Kinetix/NBN carriage, software subscriptions, utilities). Usually has an attached invoice PDF. NOT: remittance advices, payment receipts/confirmations, statements of account, invoices Centrefit SENT to its customers, or customers paying Centrefit — those are "fyi".

"action" — a real person (customer, supplier rep, staff, partner) needs Mitchell to do or decide something: quote requests, job queries, complaints, billing detail changes, approvals, scheduling. Also any email you cannot confidently place elsewhere.

"fyi" — legitimately informative, nothing to do: remittances, receipts, delivery confirmations, statements, system reports that look healthy.

"noise" — marketing, newsletters, cold sales outreach, social notifications, automated chatter.

Hard rules:
- When torn between "bill" and anything else, choose "action". A wrong bill-forward is worse than asking Mitchell.
- An invoice FROM Centrefit (Centrefit's own branding/details, INV-xxxx to a customer) is never "bill".
- Emails about changing a customer's billing/contact details are "action" (a human applies them for now).
Respond with the JSON verdict only.`;

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function classifyEmail(input: {
  mailbox: string;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  bodyText: string;
  hasAttachments: boolean;
}): Promise<TriageVerdict> {
  const body = input.bodyText.length > 6000 ? `${input.bodyText.slice(0, 6000)}\n[truncated]` : input.bodyText;
  const prompt = `Mailbox: ${input.mailbox}
From: ${input.fromName ?? "?"} <${input.fromAddress ?? "?"}>
Subject: ${input.subject ?? "(no subject)"}
Has attachments: ${input.hasAttachments}

Body:
${body}`;

  const flagFallback = (reason: string): TriageVerdict => ({
    classification: "action",
    reason,
    actionSummary: `Review email from ${input.fromName ?? input.fromAddress ?? "unknown sender"}: ${(input.subject ?? "").slice(0, 50)}`,
    billSupplier: null,
  });

  let response: Anthropic.Message;
  try {
    response = await getClient().messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      system: SYSTEM,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: VERDICT_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    // API failure → the email still gets in front of Mitchell.
    return flagFallback(`Classifier error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.stop_reason === "refusal") {
    return flagFallback("Classifier declined this content — review manually.");
  }

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  try {
    const parsed = JSON.parse(text) as {
      classification: TriageClass;
      reason: string;
      action_summary: string | null;
      bill_supplier: string | null;
    };
    if (!["bill", "action", "fyi", "noise"].includes(parsed.classification)) {
      return flagFallback("Classifier returned an unknown tier.");
    }
    return {
      classification: parsed.classification,
      reason: parsed.reason,
      actionSummary: parsed.action_summary,
      billSupplier: parsed.bill_supplier,
    };
  } catch {
    return flagFallback("Classifier output was not valid JSON.");
  }
}
