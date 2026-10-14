"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";

interface JobLite {
  id: string;
  number: string | null;
  label: string;
}

/**
 * Upload lifecycle (2026-09-16 rework — Mitchell: "sometimes it's not
 * sending through", camera-roll picks "just sit there", and Mark can't see
 * the tiny green tick; 2026-10-15: emails go to the accountant, not Xero,
 * and the email no longer waits on the receipt read):
 *   preparing  → picked, shown immediately, being re-encoded
 *   queued     → ready to upload
 *   sending    → POST in flight (90 s timeout, one automatic retry)
 *   saved      → stored in the CRM; the email is going out, we poll /status
 *   forwarded  → in the accountant's inbox
 *   failed     → upload never landed (tap to retry)
 *   forward_failed → stored but the email didn't go (tap to retry the send)
 */
type ItemStatus = "preparing" | "queued" | "sending" | "saved" | "forwarded" | "failed" | "forward_failed";
interface QueueItem {
  key: string;
  original: Blob;
  blob: Blob | null;
  name: string;
  source: "snap" | "bulk";
  status: ItemStatus;
  error?: string;
  preview: string;
  receiptId?: string;
  /** "CFA05281" · "Fuel · CFT003" · "No job attached" — the tail of the email line. */
  tagLabel?: string;
  attempts: number;
  savedAt?: number;
  /** When the item entered the queue — prep_ms on the upload = queued − this. */
  enqueuedAt: number;
  prepMs?: number;
}

type Banner =
  | { kind: "success"; title: string; detail: string | null; at: number }
  | { kind: "pending"; title: string; detail: string | null; at: number }
  | { kind: "error"; title: string; detail: string | null; at: number; retryKey: string };

const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.8;
/** Camera-roll JPEG/PNG/WebP up to this size go as-is — no decode, no re-encode. */
const SEND_AS_IS_BYTES = 6 * 1024 * 1024;
/** If a decode + re-encode hasn't finished by now, send the original instead. */
const PREP_TIMEOUT_MS = 12_000;
const UPLOAD_CONCURRENCY = 2;
const PREP_CONCURRENCY = 2;
const UPLOAD_TIMEOUT_MS = 90_000;
const POLL_MS = 3_000;
const POLL_GIVE_UP_MS = 150_000;

// Camera-roll photos arrive as 2–4 MB JPEG (iOS transcodes HEIC for file
// inputs) or occasionally HEIC. 15 Oct 2026 (Mitchell: "still says preparing
// for ages… well over a minute"): the decode + canvas re-encode on the phone
// was the whole wait, so JPEG/PNG/WebP under SEND_AS_IS_BYTES now go exactly
// as they are, and only HEIC / oversized files take the decode path — with a
// timeout that falls back to the original. The shutter never comes through
// here at all (it draws straight to a capped canvas).
// (Do NOT touch this path without a real-iPhone test — the 28 Sep 2026
// "speed-up" silently stopped every upload.)
async function normalise(file: Blob, name: string): Promise<{ blob: Blob; name: string }> {
  if (file.type === "application/pdf") return { blob: file, name };
  if (/^image\/(jpeg|jpg|png|webp)$/i.test(file.type) && file.size <= SEND_AS_IS_BYTES) return { blob: file, name };
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("prep timeout")), PREP_TIMEOUT_MS));
  try {
    const bmp = await Promise.race([createImageBitmap(file, { imageOrientation: "from-image" }), timeout]);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await Promise.race([new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", JPEG_QUALITY)), timeout]);
    if (!blob) throw new Error("encode failed");
    return { blob, name: name.replace(/\.[^.]+$/, "") + ".jpg" };
  } catch {
    return { blob: file, name };
  }
}

export function SnapClient({
  staffName,
  todayJobs,
  fuelRegos,
  destLabel,
  destConfigured,
  isAdmin,
  needsPairing,
}: {
  staffName: string;
  todayJobs: JobLite[];
  /** Regos the Fuel toggle offers (Settings → Billing). */
  fuelRegos: string[];
  /** Who the email goes to, as the phone names it ("Jeremiah"). */
  destLabel: string;
  destConfigured: boolean;
  isAdmin: boolean;
  needsPairing: boolean;
}) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"starting" | "live" | "fallback">("starting");
  const [job, setJob] = useState<JobLite | null>(todayJobs[0] ?? null);
  const [jobSheet, setJobSheet] = useState(false);
  // Fuel toggle: on → the receipt is tagged with a rego instead of a job.
  const [fuel, setFuel] = useState(false);
  const [rego, setRego] = useState<string | null>(fuelRegos[0] ?? null);
  const [regoSheet, setRegoSheet] = useState(false);
  const [flash, setFlash] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [forwardedToday, setForwardedToday] = useState(0);
  const inFlight = useRef(0);
  const preparing = useRef(0);
  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;
  const jobRef = useRef<JobLite | null>(job);
  jobRef.current = job;
  const fuelRef = useRef<{ on: boolean; rego: string | null }>({ on: fuel, rego });
  fuelRef.current = { on: fuel, rego };

  // ── Camera ──────────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMode("fallback");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
      setMode("live");
    } catch {
      setMode("fallback");
    }
  }, []);

  // Session-authed open with no (or someone else's) device cookie: pair this
  // phone in the background so future opens skip login entirely. The pair
  // endpoint also re-stamps the cookie expiry, so in-use phones never lapse.
  useEffect(() => {
    if (!needsPairing) return;
    void fetch("/api/snap/pair", { method: "POST" }).catch(() => {});
  }, [needsPairing]);

  useEffect(() => {
    void startCamera();
    const onVis = () => {
      if (document.hidden) stopCamera();
      else if (mode !== "fallback") void startCamera();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Feedback ────────────────────────────────────────────────────────────
  const show = useCallback((b: Banner) => {
    setBanner(b);
    if (b.kind === "success") navigator.vibrate?.([40, 60, 40]);
    if (b.kind === "error") navigator.vibrate?.([250]);
  }, []);
  // Success / pending banners clear themselves; errors stay until acted on.
  useEffect(() => {
    if (!banner || banner.kind === "error") return;
    const t = setTimeout(() => setBanner((b) => (b && b.at === banner.at ? null : b)), banner.kind === "success" ? 4500 : 8000);
    return () => clearTimeout(t);
  }, [banner]);

  // ── Queue plumbing ──────────────────────────────────────────────────────
  const patch = useCallback((key: string, p: Partial<QueueItem>) => {
    setQueue((q) => q.map((i) => (i.key === key ? { ...i, ...p } : i)));
  }, []);

  const uploadOnce = useCallback(async (item: QueueItem, blob: Blob): Promise<{ id: string; tagLabel: string }> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const fd = new FormData();
      fd.append("file", blob, item.name);
      const f = fuelRef.current;
      if (f.on && f.rego) {
        fd.append("fuel", "1");
        fd.append("rego", f.rego);
      } else if (jobRef.current) {
        fd.append("job_id", jobRef.current.id);
      }
      fd.append("source", item.source);
      fd.append("orig_bytes", String(item.original.size));
      fd.append("prep_ms", String(item.prepMs ?? 0));
      const res = await fetch("/api/receipts/snap", { method: "POST", body: fd, signal: ctrl.signal });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          res.status === 413
            ? "Photo too large to upload — try the camera button instead of the photo roll"
            : res.status === 401
            ? "This phone isn't signed in — open the CRM once and try again"
            : j.error ?? `Upload failed (${res.status})`,
        );
      }
      if (!j.id) throw new Error("Upload didn't return a receipt id");
      return { id: j.id, tagLabel: typeof j.tagLabel === "string" ? j.tagLabel : "" };
    } finally {
      clearTimeout(timer);
    }
  }, []);

  const send = useCallback(
    async (item: QueueItem) => {
      inFlight.current += 1;
      patch(item.key, { status: "sending", error: undefined });
      const blob = item.blob ?? item.original;
      let attempts = item.attempts;
      try {
        let result: { id: string; tagLabel: string } | null = null;
        let lastErr: unknown = null;
        // One automatic retry for the flaky-4G case; then the user decides.
        while (attempts < 2 && !result) {
          attempts += 1;
          try {
            result = await uploadOnce(item, blob);
          } catch (e) {
            lastErr = e;
            const msg = e instanceof Error ? e.message : "";
            const transient = e instanceof DOMException || /failed to fetch|network|load failed|timed out/i.test(msg);
            if (!transient || attempts >= 2) break;
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        if (!result) {
          const raw = lastErr instanceof Error ? lastErr.message : "Upload failed";
          const msg = lastErr instanceof DOMException && lastErr.name === "AbortError" ? "Upload timed out — poor signal?" : raw;
          patch(item.key, { status: "failed", error: msg, attempts });
          show({ kind: "error", title: "Didn't send", detail: msg, at: Date.now(), retryKey: item.key });
          return;
        }
        patch(item.key, { status: "saved", receiptId: result.id, tagLabel: result.tagLabel, attempts, savedAt: Date.now() });
        show({ kind: "pending", title: `Saved — emailing ${destLabel}…`, detail: result.tagLabel || null, at: Date.now() });
      } finally {
        inFlight.current -= 1;
        pump();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patch, uploadOnce, show, destLabel],
  );

  const pump = useCallback(() => {
    while (inFlight.current < UPLOAD_CONCURRENCY) {
      const next = queueRef.current.find((i) => i.status === "queued");
      if (!next) break;
      // Mark synchronously so a second pump() in the same tick can't pick it again.
      next.status = "sending";
      void send(next);
    }
  }, [send]);

  // Re-encode in a small pool so a 10-photo pick shows progress instead of
  // freezing until every image has been decoded.
  const prepPump = useCallback(() => {
    while (preparing.current < PREP_CONCURRENCY) {
      const next = queueRef.current.find((i) => i.status === "preparing" && !i.blob && !(i as QueueItem & { _prepping?: boolean })._prepping);
      if (!next) break;
      (next as QueueItem & { _prepping?: boolean })._prepping = true;
      preparing.current += 1;
      void normalise(next.original, next.name)
        .then(({ blob, name }) => {
          // swap the preview to the (smaller) encoded image
          const preview = blob !== next.original ? URL.createObjectURL(blob) : next.preview;
          patch(next.key, { blob, name, preview, status: "queued", prepMs: Date.now() - next.enqueuedAt });
        })
        .catch(() => patch(next.key, { blob: next.original, status: "queued", prepMs: Date.now() - next.enqueuedAt }))
        .finally(() => {
          preparing.current -= 1;
          setTimeout(() => {
            prepPump();
            pump();
          }, 0);
        });
    }
  }, [patch, pump]);

  const enqueue = useCallback(
    (files: Array<{ blob: Blob; name: string }>, source: "snap" | "bulk", ready = false) => {
      const items: QueueItem[] = files.map((f) => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        original: f.blob,
        // `ready` = the shutter's own capped JPEG: nothing to prepare.
        blob: ready ? f.blob : null,
        name: f.name,
        source,
        status: ready ? "queued" : "preparing",
        preview: URL.createObjectURL(f.blob),
        attempts: 0,
        enqueuedAt: Date.now(),
        prepMs: ready ? 0 : undefined,
      }));
      setQueue((q) => [...q, ...items]);
    },
    [],
  );

  // The ONE place uploads get kicked off: every time the queue changes
  // (after React has rendered it, so queueRef is current), prepare what
  // needs preparing and upload what's ready. A setTimeout(0) kicker could
  // run before the render and leave an item sitting on "Waiting" forever
  // (Mitchell, 15 Oct 2026 08:40, fuel receipt 743QU5).
  useEffect(() => {
    prepPump();
    pump();
  }, [queue, prepPump, pump]);

  // ── Poll saved receipts until the email has gone ────────────────────────
  useEffect(() => {
    const t = setInterval(async () => {
      const waiting = queueRef.current.filter((i) => i.status === "saved" && i.receiptId);
      if (waiting.length === 0) return;
      try {
        const res = await fetch(`/api/receipts/snap/status?ids=${waiting.map((i) => i.receiptId).join(",")}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { statuses: Array<{ id: string; stage: "processing" | "forwarded" | "failed"; error: string | null }> };
        for (const s of j.statuses ?? []) {
          const item = waiting.find((i) => i.receiptId === s.id);
          if (!item) continue;
          if (s.stage === "forwarded") {
            patch(item.key, { status: "forwarded" });
            setForwardedToday((n) => n + 1);
            show({ kind: "success", title: `Sent to ${destLabel}`, detail: item.tagLabel || null, at: Date.now() });
            setTimeout(() => setQueue((q) => q.filter((i) => i.key !== item.key || i.status !== "forwarded")), 6000);
          } else if (s.stage === "failed") {
            patch(item.key, { status: "forward_failed", error: s.error ?? `${destLabel} didn't get it` });
            show({ kind: "error", title: `Saved, but ${destLabel} didn't get it`, detail: s.error ?? "Tap Retry to send it again", at: Date.now(), retryKey: item.key });
          } else if (item.savedAt && Date.now() - item.savedAt > POLL_GIVE_UP_MS) {
            // Still processing after a long while — stop polling; the daily
            // sweep will finish the send. Say so instead of spinning forever.
            patch(item.key, { status: "forwarded", error: "slow" });
            show({ kind: "pending", title: "Saved in the CRM", detail: "The email is taking a while — it retries itself, nothing more to do.", at: Date.now() });
          }
        }
      } catch {
        // network blip — try again next tick
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [patch, show, destLabel]);

  // ── Retry ───────────────────────────────────────────────────────────────
  const retry = useCallback(
    async (key: string) => {
      const item = queueRef.current.find((i) => i.key === key);
      if (!item) return;
      setBanner(null);
      if (item.status === "failed") {
        patch(key, { status: "queued", error: undefined, attempts: 0 });
        return;
      }
      if (item.status === "forward_failed" && item.receiptId) {
        patch(key, { status: "saved", error: undefined, savedAt: Date.now() });
        show({ kind: "pending", title: `Retrying the email to ${destLabel}…`, detail: null, at: Date.now() });
        try {
          const res = await fetch("/api/receipts/snap/retry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: item.receiptId }),
          });
          const j = await res.json().catch(() => ({}));
          if (res.ok && j.status?.stage === "forwarded") {
            patch(key, { status: "forwarded" });
            setForwardedToday((n) => n + 1);
            show({ kind: "success", title: `Sent to ${destLabel}`, detail: item.tagLabel || null, at: Date.now() });
            setTimeout(() => setQueue((q) => q.filter((i) => i.key !== key || i.status !== "forwarded")), 6000);
          } else {
            const msg = j.error ?? j.status?.error ?? "Still couldn't send the email";
            patch(key, { status: "forward_failed", error: msg });
            show({ kind: "error", title: `Still not with ${destLabel}`, detail: `${msg}. It's saved — the morning sweep will try again.`, at: Date.now(), retryKey: key });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Retry failed";
          patch(key, { status: "forward_failed", error: msg });
          show({ kind: "error", title: "Retry failed", detail: msg, at: Date.now(), retryKey: key });
        }
      }
    },
    [patch, show, destLabel],
  );

  // ── Capture ─────────────────────────────────────────────────────────────
  async function shutter() {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || !v.videoWidth) {
      toast("Camera not ready yet", "error");
      return;
    }
    // One canvas, already capped to MAX_EDGE: the blob this produces is the
    // upload. No second decode/encode pass (that was the "Preparing" wait).
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    navigator.vibrate?.(30);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", JPEG_QUALITY));
    canvas.width = 0; // release iOS canvas memory straight away
    canvas.height = 0;
    if (!blob) {
      toast("Couldn't capture that — try again", "error");
      return;
    }
    enqueue([{ blob, name: `receipt-${Date.now()}.jpg` }], "snap", true);
  }

  function onFiles(list: FileList | null, source: "snap" | "bulk") {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    enqueue(
      files.map((f) => ({ blob: f, name: f.name || `receipt-${Date.now()}.jpg` })),
      source,
    );
    show({
      kind: "pending",
      title: files.length === 1 ? "Got it — preparing your photo" : `Got ${files.length} photos — preparing`,
      detail: "Uploads start as soon as each one is ready.",
      at: Date.now(),
    });
  }

  // ── Fuel toggle ─────────────────────────────────────────────────────────
  function toggleFuel() {
    if (fuel) {
      setFuel(false);
      return;
    }
    if (fuelRegos.length === 0) {
      toast(isAdmin ? "No vehicles set up — add regos in Settings → Billing" : "No vehicles set up yet — ask the office", "error");
      return;
    }
    setRegoSheet(true);
  }

  const busy = queue.filter((i) => ["preparing", "queued", "sending", "saved"].includes(i.status)).length;
  const problems = queue.filter((i) => i.status === "failed" || i.status === "forward_failed");
  const fuelOn = fuel && !!rego;

  const STATUS_LABEL: Record<ItemStatus, string> = {
    preparing: "Preparing",
    queued: "Waiting",
    sending: "Uploading",
    saved: "Emailing…",
    forwarded: "Sent ✓",
    failed: "Retry",
    forward_failed: "Retry",
  };

  return (
    <div
      className="relative flex flex-col overflow-hidden bg-[#0b1220] text-white select-none"
      style={{ height: "var(--app-height, 100dvh)" }}
    >
      {/* Viewfinder */}
      <div className="absolute inset-0">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`h-full w-full object-cover ${mode === "live" ? "opacity-100" : "opacity-0"} transition-opacity`}
        />
        {mode !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            {mode === "starting" ? (
              <p className="text-sm text-white/60">Starting camera…</p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => captureInputRef.current?.click()}
                  className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-full bg-amber-400 text-[#0b1220] shadow-2xl active:scale-95 transition-transform"
                >
                  <CameraGlyph className="h-10 w-10" />
                  <span className="text-sm font-semibold">Take photo</span>
                </button>
                <p className="max-w-xs text-xs text-white/50">
                  Camera preview isn&rsquo;t available here — this button opens the camera instead.
                </p>
              </>
            )}
          </div>
        )}
        {flash && <div className="absolute inset-0 bg-white/80" />}
      </div>

      {/* Top bar: what the receipt is tagged with (job or fuel rego), the Fuel toggle, and the status pill */}
      <div className="relative z-10 flex items-start justify-between gap-2 px-4 pt-[max(env(safe-area-inset-top),12px)]">
        <div className="flex min-w-0 flex-1 items-stretch gap-2">
          {fuelOn ? (
            <button
              type="button"
              onClick={() => setRegoSheet(true)}
              className="min-w-0 max-w-[55%] rounded-full bg-amber-400 px-3 py-1.5 text-left text-xs text-[#0b1220]"
            >
              <span className="block text-[10px] uppercase tracking-wider opacity-70">Fuel · vehicle</span>
              <span className="block truncate font-bold">{rego}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setJobSheet(true)}
              className="min-w-0 max-w-[55%] rounded-full bg-black/55 px-3 py-1.5 text-left text-xs backdrop-blur"
            >
              <span className="block text-[10px] uppercase tracking-wider text-white/50">Job</span>
              <span className="block truncate font-medium">{job ? job.label : "No job — tap to pick"}</span>
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={fuelOn}
            onClick={toggleFuel}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold backdrop-blur transition-colors ${
              fuelOn ? "bg-amber-400 text-[#0b1220]" : "bg-black/55 text-white/90"
            }`}
          >
            <FuelGlyph className="h-4 w-4" />
            Fuel
            <span className={`ml-0.5 inline-block h-3.5 w-6 rounded-full ${fuelOn ? "bg-[#0b1220]/80" : "bg-white/25"} relative`} aria-hidden>
              <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${fuelOn ? "left-3" : "left-0.5"}`} />
            </span>
          </button>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`rounded-full px-3 py-1.5 text-sm font-semibold backdrop-blur ${
              busy > 0 ? "bg-amber-400 text-[#0b1220]" : forwardedToday > 0 ? "bg-emerald-500 text-white" : "bg-black/55 text-white/90"
            }`}
          >
            {busy > 0 ? `Sending ${busy}…` : forwardedToday > 0 ? `✓ ${forwardedToday} sent` : staffName}
          </span>
          {isAdmin && !destConfigured && (
            <Link href="/settings/billing" className="rounded-full bg-amber-500/90 px-2.5 py-1 text-[10px] font-medium text-[#0b1220]">
              Going to accounts@ — set the receipts email
            </Link>
          )}
        </div>
      </div>

      {/* Big feedback banner — the thing Mark can actually see */}
      {banner && (
        <div
          role="status"
          aria-live="polite"
          className={`relative z-20 mx-4 mt-3 rounded-2xl px-4 py-3 shadow-2xl ${
            banner.kind === "success"
              ? "bg-emerald-500 text-white"
              : banner.kind === "error"
              ? "bg-red-600 text-white"
              : "bg-amber-400 text-[#0b1220]"
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl leading-none" aria-hidden>
              {banner.kind === "success" ? "✓" : banner.kind === "error" ? "✕" : "…"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold leading-tight">{banner.title}</p>
              {banner.detail && <p className="mt-0.5 text-sm leading-snug opacity-90">{banner.detail}</p>}
            </div>
            {banner.kind === "error" ? (
              <button
                type="button"
                onClick={() => void retry(banner.retryKey)}
                className="shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-bold text-red-700 active:scale-95"
              >
                Retry
              </button>
            ) : (
              <button type="button" aria-label="Dismiss" onClick={() => setBanner(null)} className="shrink-0 px-2 text-lg opacity-70">
                ×
              </button>
            )}
          </div>
        </div>
      )}

      {/* Queue strip */}
      {queue.length > 0 && (
        <div className="relative z-10 mt-auto flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-hide">
          {queue.map((i) => (
            <button
              key={i.key}
              type="button"
              onClick={() => (i.status === "failed" || i.status === "forward_failed" ? void retry(i.key) : undefined)}
              className="relative h-24 w-[72px] shrink-0 overflow-hidden rounded-lg bg-black/40 text-left"
              aria-label={`${i.name}: ${STATUS_LABEL[i.status]}`}
            >
              {i.original.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.preview} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-[11px]">PDF</div>
              )}
              {(i.status === "preparing" || i.status === "sending" || i.status === "saved") && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                </div>
              )}
              <div
                className={`absolute inset-x-0 bottom-0 py-1 text-center text-[11px] font-bold ${
                  i.status === "forwarded"
                    ? "bg-emerald-500 text-white"
                    : i.status === "failed" || i.status === "forward_failed"
                    ? "bg-red-600 text-white"
                    : "bg-black/70 text-white"
                }`}
              >
                {STATUS_LABEL[i.status]}
              </div>
            </button>
          ))}
        </div>
      )}
      {problems.length > 0 && !banner && (
        <p className="relative z-10 px-4 pb-1 text-center text-xs font-medium text-red-300">
          {problems.length} didn&rsquo;t reach {destLabel} — tap a red one to retry.
        </p>
      )}

      {/* Bottom controls */}
      <div className={`relative z-10 ${queue.length > 0 ? "" : "mt-auto"} flex items-center justify-between px-8 pb-[max(env(safe-area-inset-bottom),20px)] pt-3`}>
        <button
          type="button"
          onClick={() => bulkInputRef.current?.click()}
          className="flex h-14 w-14 flex-col items-center justify-center rounded-full bg-black/55 text-[10px] backdrop-blur active:scale-95 transition-transform"
        >
          <PhotosGlyph className="h-5 w-5" />
          <span className="mt-0.5">Photos</span>
        </button>
        <button
          type="button"
          onClick={() => (mode === "live" ? void shutter() : captureInputRef.current?.click())}
          aria-label="Take photo"
          className="flex h-[76px] w-[76px] items-center justify-center rounded-full border-4 border-white/80 active:scale-95 transition-transform"
        >
          <span className="h-[62px] w-[62px] rounded-full bg-white" />
        </button>
        {/* Spacer where the CRM link used to be — keeps the shutter centred. */}
        <div className="h-14 w-14" aria-hidden />
      </div>

      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files, "snap");
          e.target.value = "";
        }}
      />
      <input
        ref={bulkInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files, "bulk");
          e.target.value = "";
        }}
      />

      {/* Job sheet */}
      {jobSheet && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end bg-black/60" onClick={() => setJobSheet(false)}>
          <div
            className="rounded-t-2xl bg-[#111a2e] px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] uppercase tracking-wider text-white/50">Attach receipts to</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {todayJobs.length === 0 && (
                <p className="py-2 text-xs text-white/60">Nothing scheduled for you today. It still goes to {destLabel} as &ldquo;no job attached&rdquo;.</p>
              )}
              {todayJobs.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => {
                    setJob(j);
                    setJobSheet(false);
                  }}
                  className={`rounded-lg px-3 py-3 text-left text-sm ${job?.id === j.id ? "bg-amber-400 text-[#0b1220] font-semibold" : "bg-white/10"}`}
                >
                  {j.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setJob(null);
                  setJobSheet(false);
                }}
                className={`rounded-lg px-3 py-3 text-left text-sm ${job === null ? "bg-amber-400 text-[#0b1220] font-semibold" : "bg-white/10"}`}
              >
                No job
              </button>
            </div>
            <p className="mt-3 text-[11px] text-white/40">Fuel? Use the Fuel toggle instead — it tags the rego, not a job.</p>
          </div>
        </div>
      )}

      {/* Rego sheet (Fuel toggle) */}
      {regoSheet && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end bg-black/60" onClick={() => setRegoSheet(false)}>
          <div
            className="rounded-t-2xl bg-[#111a2e] px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] uppercase tracking-wider text-white/50">Fuel receipt — which vehicle?</p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {fuelRegos.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRego(r);
                    setFuel(true);
                    setRegoSheet(false);
                  }}
                  className={`rounded-lg px-3 py-3 text-left font-mono text-base ${fuelOn && rego === r ? "bg-amber-400 text-[#0b1220] font-bold" : "bg-white/10"}`}
                >
                  {r}
                </button>
              ))}
            </div>
            {fuelOn && (
              <button
                type="button"
                onClick={() => {
                  setFuel(false);
                  setRegoSheet(false);
                }}
                className="mt-2 w-full rounded-lg bg-white/10 px-3 py-3 text-left text-sm"
              >
                Not fuel — back to job receipts
              </button>
            )}
            <p className="mt-3 text-[11px] text-white/40">Fuel stays on until you turn it off, so every snap in a row is tagged with this rego.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function CameraGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
function PhotosGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 16 5-5 4 4 3-3 6 6" />
      <circle cx="16" cy="9" r="1.5" />
    </svg>
  );
}
function FuelGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
      <path d="M3 21h12" />
      <rect x="6" y="6" width="6" height="4" rx="0.5" />
      <path d="M14 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-2.5-2.5" />
    </svg>
  );
}
