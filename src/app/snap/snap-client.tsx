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
 * the tiny green tick):
 *   preparing  → picked, shown immediately, being re-encoded
 *   queued     → ready to upload
 *   sending    → POST in flight (90 s timeout, one automatic retry)
 *   saved      → stored in the CRM; the read + forward to Xero is running,
 *                we poll /status until it lands
 *   forwarded  → in Xero's bills inbox (vendor + amount shown)
 *   failed     → upload never landed (tap to retry)
 *   forward_failed → stored but Xero didn't get it (tap to retry the forward)
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
  vendor?: string | null;
  amount?: number | null;
  attempts: number;
  savedAt?: number;
}

type Banner =
  | { kind: "success"; title: string; detail: string | null; at: number }
  | { kind: "pending"; title: string; detail: string | null; at: number }
  | { kind: "error"; title: string; detail: string | null; at: number; retryKey: string };

const MAX_EDGE = 2400;
const JPEG_QUALITY = 0.85;
const UPLOAD_CONCURRENCY = 2;
const PREP_CONCURRENCY = 2;
const UPLOAD_TIMEOUT_MS = 90_000;
const POLL_MS = 3_000;
const POLL_GIVE_UP_MS = 150_000;

// Camera-roll photos arrive as 3–4 MB HEIC/JPEG. Re-encode to a capped JPEG so
// uploads are quick on 4G and Xero's capture gets a format it can read.
// Safari decodes HEIC natively via createImageBitmap; anything that fails
// decoding is sent as-is.
async function normalise(file: Blob, name: string): Promise<{ blob: Blob; name: string }> {
  if (file.type === "application/pdf") return { blob: file, name };
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
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
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("encode failed");
    return { blob, name: name.replace(/\.[^.]+$/, "") + ".jpg" };
  } catch {
    return { blob: file, name };
  }
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? null : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function SnapClient({
  staffName,
  todayJobs,
  viaXero,
  isAdmin,
  needsPairing,
}: {
  staffName: string;
  todayJobs: JobLite[];
  viaXero: boolean;
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

  const uploadOnce = useCallback(async (item: QueueItem, blob: Blob): Promise<{ id: string }> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const fd = new FormData();
      fd.append("file", blob, item.name);
      if (jobRef.current) fd.append("job_id", jobRef.current.id);
      fd.append("source", item.source);
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
      return { id: j.id };
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
        let result: { id: string } | null = null;
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
        patch(item.key, { status: "saved", receiptId: result.id, attempts, savedAt: Date.now() });
        show({ kind: "pending", title: "Saved — sending to Xero…", detail: "You'll see a green confirmation when it lands.", at: Date.now() });
      } finally {
        inFlight.current -= 1;
        pump();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patch, uploadOnce, show],
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
          patch(next.key, { blob, name, preview, status: "queued" });
        })
        .catch(() => patch(next.key, { blob: next.original, status: "queued" }))
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
    (files: Array<{ blob: Blob; name: string }>, source: "snap" | "bulk") => {
      const items: QueueItem[] = files.map((f) => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        original: f.blob,
        blob: null,
        name: f.name,
        source,
        status: "preparing",
        preview: URL.createObjectURL(f.blob),
        attempts: 0,
      }));
      setQueue((q) => [...q, ...items]);
      setTimeout(prepPump, 0);
    },
    [prepPump],
  );

  // ── Poll saved receipts until Xero has them ─────────────────────────────
  useEffect(() => {
    const t = setInterval(async () => {
      const waiting = queueRef.current.filter((i) => i.status === "saved" && i.receiptId);
      if (waiting.length === 0) return;
      try {
        const res = await fetch(`/api/receipts/snap/status?ids=${waiting.map((i) => i.receiptId).join(",")}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { statuses: Array<{ id: string; stage: "processing" | "forwarded" | "failed"; vendor: string | null; amount: number | null; error: string | null }> };
        for (const s of j.statuses ?? []) {
          const item = waiting.find((i) => i.receiptId === s.id);
          if (!item) continue;
          if (s.stage === "forwarded") {
            patch(item.key, { status: "forwarded", vendor: s.vendor, amount: s.amount });
            setForwardedToday((n) => n + 1);
            show({
              kind: "success",
              title: "Sent to Xero",
              detail: [s.vendor, money(s.amount)].filter(Boolean).join(" · ") || "Receipt delivered to the bills inbox",
              at: Date.now(),
            });
            setTimeout(() => setQueue((q) => q.filter((i) => i.key !== item.key || i.status !== "forwarded")), 6000);
          } else if (s.stage === "failed") {
            patch(item.key, { status: "forward_failed", error: s.error ?? "Xero didn't get it" });
            show({ kind: "error", title: "Saved, but Xero didn't get it", detail: s.error ?? "Tap Retry to send it again", at: Date.now(), retryKey: item.key });
          } else if (item.savedAt && Date.now() - item.savedAt > POLL_GIVE_UP_MS) {
            // Still processing after a long while — stop polling; the daily
            // sweep will finish the forward. Say so instead of spinning forever.
            patch(item.key, { status: "forwarded", vendor: null, amount: null, error: "slow" });
            show({ kind: "pending", title: "Saved in the CRM", detail: "Xero delivery is taking a while — it retries itself, nothing more to do.", at: Date.now() });
          }
        }
      } catch {
        // network blip — try again next tick
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [patch, show]);

  // ── Retry ───────────────────────────────────────────────────────────────
  const retry = useCallback(
    async (key: string) => {
      const item = queueRef.current.find((i) => i.key === key);
      if (!item) return;
      setBanner(null);
      if (item.status === "failed") {
        patch(key, { status: "queued", error: undefined, attempts: 0 });
        setTimeout(pump, 0);
        return;
      }
      if (item.status === "forward_failed" && item.receiptId) {
        patch(key, { status: "saved", error: undefined, savedAt: Date.now() });
        show({ kind: "pending", title: "Retrying the send to Xero…", detail: null, at: Date.now() });
        try {
          const res = await fetch("/api/receipts/snap/retry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: item.receiptId }),
          });
          const j = await res.json().catch(() => ({}));
          if (res.ok && j.status?.stage === "forwarded") {
            patch(key, { status: "forwarded", vendor: j.status.vendor, amount: j.status.amount });
            setForwardedToday((n) => n + 1);
            show({ kind: "success", title: "Sent to Xero", detail: [j.status.vendor, money(j.status.amount)].filter(Boolean).join(" · ") || null, at: Date.now() });
            setTimeout(() => setQueue((q) => q.filter((i) => i.key !== key || i.status !== "forwarded")), 6000);
          } else {
            const msg = j.error ?? j.status?.error ?? "Still couldn't reach Xero";
            patch(key, { status: "forward_failed", error: msg });
            show({ kind: "error", title: "Still not in Xero", detail: `${msg}. It's saved — the office can forward it from Receipts.`, at: Date.now(), retryKey: key });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Retry failed";
          patch(key, { status: "forward_failed", error: msg });
          show({ kind: "error", title: "Retry failed", detail: msg, at: Date.now(), retryKey: key });
        }
      }
    },
    [patch, pump, show],
  );

  // ── Capture ─────────────────────────────────────────────────────────────
  async function shutter() {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || !v.videoWidth) {
      toast("Camera not ready yet", "error");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", JPEG_QUALITY));
    if (!blob) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    navigator.vibrate?.(30);
    enqueue([{ blob, name: `receipt-${Date.now()}.jpg` }], "snap");
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

  const busy = queue.filter((i) => ["preparing", "queued", "sending", "saved"].includes(i.status)).length;
  const problems = queue.filter((i) => i.status === "failed" || i.status === "forward_failed");

  const STATUS_LABEL: Record<ItemStatus, string> = {
    preparing: "Preparing",
    queued: "Waiting",
    sending: "Uploading",
    saved: "To Xero…",
    forwarded: "In Xero ✓",
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

      {/* Top bar */}
      <div className="relative z-10 flex items-start justify-between gap-2 px-4 pt-[max(env(safe-area-inset-top),12px)]">
        <button
          type="button"
          onClick={() => setJobSheet(true)}
          className="max-w-[60%] rounded-full bg-black/55 px-3 py-1.5 text-left text-xs backdrop-blur"
        >
          <span className="block text-[10px] uppercase tracking-wider text-white/50">Job</span>
          <span className="block truncate font-medium">{job ? job.label : "No job — tap to pick"}</span>
        </button>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`rounded-full px-3 py-1.5 text-sm font-semibold backdrop-blur ${
              busy > 0 ? "bg-amber-400 text-[#0b1220]" : forwardedToday > 0 ? "bg-emerald-500 text-white" : "bg-black/55 text-white/90"
            }`}
          >
            {busy > 0 ? `Sending ${busy}…` : forwardedToday > 0 ? `✓ ${forwardedToday} in Xero` : staffName}
          </span>
          {isAdmin && !viaXero && (
            <Link href="/settings/billing" className="rounded-full bg-amber-500/90 px-2.5 py-1 text-[10px] font-medium text-[#0b1220]">
              Going to accounts@ — set Xero inbox
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
          {problems.length} didn&rsquo;t reach Xero — tap a red one to retry.
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
                <p className="py-2 text-xs text-white/60">Nothing scheduled for you today. Receipts still go to accounts — the office links the job.</p>
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
            <p className="mt-3 text-[11px] text-white/40">Other jobs can be linked from Receipts in the CRM.</p>
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
