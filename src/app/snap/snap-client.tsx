"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";

interface JobLite {
  id: string;
  number: string | null;
  label: string;
}

type ItemStatus = "queued" | "sending" | "sent" | "failed";
interface QueueItem {
  key: string;
  blob: Blob;
  name: string;
  source: "snap" | "bulk";
  status: ItemStatus;
  error?: string;
  preview: string;
}

const MAX_EDGE = 2400;
const JPEG_QUALITY = 0.85;
const CONCURRENCY = 2;

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
  const inFlight = useRef(0);
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

  // ── Upload queue ────────────────────────────────────────────────────────
  const patch = useCallback((key: string, p: Partial<QueueItem>) => {
    setQueue((q) => q.map((i) => (i.key === key ? { ...i, ...p } : i)));
  }, []);

  const send = useCallback(
    async (item: QueueItem) => {
      inFlight.current += 1;
      patch(item.key, { status: "sending", error: undefined });
      try {
        const fd = new FormData();
        fd.append("file", item.blob, item.name);
        if (jobRef.current) fd.append("job_id", jobRef.current.id);
        fd.append("source", item.source);
        const res = await fetch("/api/receipts/snap", { method: "POST", body: fd });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? `Upload failed (${res.status})`);
        patch(item.key, { status: "sent" });
        // Drop the preview after a beat so the strip doesn't grow forever.
        setTimeout(() => {
          setQueue((q) => q.filter((i) => i.key !== item.key || i.status !== "sent"));
        }, 4000);
      } catch (e) {
        patch(item.key, { status: "failed", error: e instanceof Error ? e.message : "Upload failed" });
      } finally {
        inFlight.current -= 1;
        pump();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patch],
  );

  const pump = useCallback(() => {
    while (inFlight.current < CONCURRENCY) {
      const next = queueRef.current.find((i) => i.status === "queued");
      if (!next) break;
      // Mark synchronously so a second pump() in the same tick can't pick it again.
      next.status = "sending";
      void send(next);
    }
  }, [send]);

  const enqueue = useCallback(
    async (files: Array<{ blob: Blob; name: string }>, source: "snap" | "bulk") => {
      const items: QueueItem[] = [];
      for (const f of files) {
        const { blob, name } = await normalise(f.blob, f.name);
        items.push({
          key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          blob,
          name,
          source,
          status: "queued",
          preview: URL.createObjectURL(blob),
        });
      }
      setQueue((q) => [...q, ...items]);
      // Let state settle, then start sending.
      setTimeout(pump, 0);
    },
    [pump],
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
    void enqueue([{ blob, name: `receipt-${Date.now()}.jpg` }], "snap");
  }

  function onFiles(list: FileList | null, source: "snap" | "bulk") {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    void enqueue(
      files.map((f) => ({ blob: f, name: f.name || `receipt-${Date.now()}.jpg` })),
      source,
    );
    if (source === "bulk") toast(`${files.length} photo${files.length === 1 ? "" : "s"} queued`);
  }

  const sending = queue.filter((i) => i.status === "sending" || i.status === "queued").length;
  const failed = queue.filter((i) => i.status === "failed");
  const sentCount = queue.filter((i) => i.status === "sent").length;

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
          className="max-w-[70%] rounded-full bg-black/55 px-3 py-1.5 text-left text-xs backdrop-blur"
        >
          <span className="block text-[10px] uppercase tracking-wider text-white/50">Job</span>
          <span className="block truncate font-medium">{job ? job.label : "No job — tap to pick"}</span>
        </button>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full bg-black/55 px-3 py-1.5 text-xs backdrop-blur">
            {sending > 0 ? `Sending ${sending}…` : sentCount > 0 ? `✓ ${sentCount} sent` : staffName}
          </span>
          {isAdmin && !viaXero && (
            <Link href="/settings/billing" className="rounded-full bg-amber-500/90 px-2.5 py-1 text-[10px] font-medium text-[#0b1220]">
              Going to accounts@ — set Xero inbox
            </Link>
          )}
        </div>
      </div>

      {/* Queue strip */}
      {queue.length > 0 && (
        <div className="relative z-10 mt-auto flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-hide">
          {queue.map((i) => (
            <div key={i.key} className="relative h-16 w-12 shrink-0 overflow-hidden rounded-md bg-black/40">
              {i.blob.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.preview} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px]">PDF</div>
              )}
              <div
                className={`absolute inset-x-0 bottom-0 py-0.5 text-center text-[9px] font-semibold ${
                  i.status === "sent"
                    ? "bg-emerald-500 text-white"
                    : i.status === "failed"
                    ? "bg-red-500 text-white"
                    : "bg-black/60 text-white/80"
                }`}
              >
                {i.status === "sent" ? "Sent" : i.status === "failed" ? "Retry" : "…"}
              </div>
              {i.status === "failed" && (
                <button
                  type="button"
                  aria-label="Retry"
                  onClick={() => {
                    patch(i.key, { status: "queued" });
                    setTimeout(pump, 0);
                  }}
                  className="absolute inset-0"
                />
              )}
            </div>
          ))}
        </div>
      )}
      {failed.length > 0 && (
        <p className="relative z-10 px-4 pb-1 text-center text-[11px] text-red-300">
          {failed.length} didn&rsquo;t send — tap the red one to retry. {failed[0].error}
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
        <div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/60" onClick={() => setJobSheet(false)}>
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
