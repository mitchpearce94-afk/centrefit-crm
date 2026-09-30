import "server-only";

/**
 * Cortex LLM bridge client.
 *
 * Every model call in the CRM goes through the bridge on the office Mac mini
 * (Cortex gateway → gateway/src/llm.ts), which answers on Mitchell's Claude
 * Max subscription. Nothing in this codebase may call api.anthropic.com with
 * an API key (Mitchell, 30 Sep 2026: "We never built that to work off API
 * credits. Nothing should be done that way").
 *
 * Env (Vercel production): LLM_BRIDGE_URL (https://cortex.veyla.com.au) and
 * LLM_BRIDGE_TOKEN (= CORTEX_LLM_TOKEN in ~/.cortex/env on the mini).
 *
 * The bridge is not load-bearing for anything customer-facing: callers must
 * degrade (flag for a human, leave OCR fields blank) when it throws.
 */

export type BridgeModel = "haiku" | "sonnet" | "opus";

export interface BridgeCall {
  /** System prompt; the bridge has a plain "extraction service" default. */
  system?: string;
  prompt: string;
  /** Default sonnet. haiku for vision/simple extraction. */
  model?: BridgeModel;
  /** base64 image the model reads before answering. */
  image?: { data: string; mime: string };
  /** Ask the bridge to parse the reply as JSON (fences stripped). */
  json?: boolean;
  /** Model-side timeout; the HTTP timeout is this + 5 s. Default 60 s. */
  timeoutMs?: number;
}

export interface BridgeResult {
  text: string;
  json: unknown;
  ms: number;
  model: string;
}

export function bridgeConfigured(): boolean {
  return Boolean(process.env.LLM_BRIDGE_URL && process.env.LLM_BRIDGE_TOKEN);
}

export async function callBridge(call: BridgeCall): Promise<BridgeResult> {
  const base = process.env.LLM_BRIDGE_URL;
  const token = process.env.LLM_BRIDGE_TOKEN;
  if (!base || !token) throw new Error("LLM bridge not configured (LLM_BRIDGE_URL / LLM_BRIDGE_TOKEN)");
  const timeoutMs = call.timeoutMs ?? 60_000;

  const res = await fetch(`${base.replace(/\/$/, "")}/api/llm`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      system: call.system,
      prompt: call.prompt,
      model: call.model ?? "sonnet",
      image: call.image,
      json: call.json ?? false,
      timeout_ms: timeoutMs,
    }),
    signal: AbortSignal.timeout(timeoutMs + 5_000),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM bridge ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as Partial<BridgeResult>;
  return { text: data.text ?? "", json: data.json ?? null, ms: data.ms ?? 0, model: data.model ?? "" };
}
