"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { autoTransitionJobStatus } from "@/lib/job-status-transitions";
import { compressImage, mapWithConcurrency } from "@/lib/images/compress";
import { brisbaneDateISO } from "@/lib/dates";

const QUICK_LINES = [
  "Left KGSQ at __:__ and travelled to site",
  "Arrived on site at __:__",
  "Opened routed cables and terminated at controls",
  "Mounted and installed cameras",
  "Terminated all data cables",
  "Routed cables through patch panels",
  "Terminated all cables into server cabinet",
  "Tested all cameras — working as normal",
  "Tested all access control — working as normal",
  "Tested all duress buttons — working as normal",
  "Set static IP addresses to all cameras",
  "Built and mounted CCTV monitor on top of server cabinet",
  "Final walk-through with client and sign-off",
  "Left site at __:__ and travelled back",
];

export function WorkLog({
  jobId,
  entries,
}: {
  jobId: string;
  entries: any[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();

  function openNew() {
    setEditingEntry(null);
    setShowForm(true);
  }

  function openEdit(entry: any) {
    setEditingEntry(entry);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingEntry(null);
  }

  async function handleDelete(entryId: string) {
    setDeletingId(entryId);
    const { error } = await supabase
      .from("job_work_entries")
      .delete()
      .eq("id", entryId);
    if (error) {
      toast(error.message, "error");
      setDeletingId(null);
      return;
    }
    toast("Entry deleted");
    setConfirmDeleteId(null);
    setDeletingId(null);
    router.refresh();
  }

  return (
    <div id="job-work-log">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Work Completed
        </h2>
        {!showForm && (
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <span className="text-lg leading-none">+</span>
            Add Entry
          </button>
        )}
      </div>

      {/* Form (create or edit) */}
      {showForm && (
        <WorkEntryForm
          jobId={jobId}
          entry={editingEntry}
          onSaved={() => {
            closeForm();
            router.refresh();
          }}
        />
      )}

      {/* Entries */}
      <div className="space-y-4">
        {entries.map((entry: any) => {
          const images: string[] = entry.image_urls ?? [];
          const lines = entry.content.split("\n").filter((l: string) => l.trim());
          const materials: any[] = entry.materials ?? [];

          return (
            <div
              key={entry.id}
              className="rounded-lg border border-border bg-card overflow-hidden"
            >
              {/* Header — wraps on mobile so date + Edit don't squeeze. */}
              <div className="flex items-center justify-between bg-muted/50 px-4 py-2.5 border-b border-border gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  {entry.staff && (
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-1 ring-white/10"
                      style={{ backgroundColor: entry.staff.colour ?? "#3b82f6" }}
                    >
                      {entry.staff.initials}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight truncate">
                      {entry.staff?.display_name ?? "Unknown"}
                    </p>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {new Date(entry.work_date + "T00:00:00").toLocaleDateString(
                        "en-AU",
                        { weekday: "short", day: "numeric", month: "short" }
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {entry.call_out && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      Call Out
                    </span>
                  )}
                  {entry.labour_hours != null && entry.labour_hours > 0 && (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                      {entry.labour_hours}h
                    </span>
                  )}
                  <button
                    onClick={() => openEdit(entry)}
                    className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                  >
                    Edit
                  </button>
                  {confirmDeleteId === entry.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(entry.id)}
                        disabled={deletingId === entry.id}
                        className="rounded-md bg-destructive px-2.5 py-1 text-[11px] font-medium text-white hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                      >
                        {deletingId === entry.id ? "Deleting…" : "Confirm delete"}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={deletingId === entry.id}
                        className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(entry.id)}
                      className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Content */}
              <div className="px-4 py-3">
                <ul className="space-y-1">
                  {lines.map((line: string, i: number) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="text-muted-foreground mt-1.5 shrink-0">•</span>
                      <span>{line.replace(/^[-•*]\s*/, "")}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Materials */}
              {materials.length > 0 && (
                <div className="px-4 pb-3">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Materials</p>
                  <div className="flex flex-wrap gap-1.5">
                    {materials.map((m: any, i: number) => (
                      <span key={i} className={`rounded-md px-2 py-0.5 text-xs ${m.product_id ? "bg-primary/10 text-primary" : "bg-muted"}`}>
                        {m.qty}x {m.name}
                        {m.sku && <span className="ml-1 font-mono text-[10px] opacity-70">{m.sku}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Photos */}
              {images.length > 0 && (
                <div className="px-4 pb-3 flex flex-wrap gap-2">
                  {images.map((url: string, i: number) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                      <img src={url} alt="" loading="lazy" decoding="async" className="h-20 w-auto rounded-md border border-border object-cover hover:opacity-90 transition-opacity" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {entries.length === 0 && !showForm && (
          <div className="rounded-lg border border-dashed border-border py-10 text-center">
            <p className="text-sm text-muted-foreground">No work entries yet.</p>
            <button onClick={openNew} className="mt-2 text-sm text-primary hover:text-primary/80 transition-colors">
              Add the first entry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Work Entry Form (create + edit) ── */
function WorkEntryForm({
  jobId,
  entry,
  onSaved,
}: {
  jobId: string;
  entry: any | null;
  onSaved: () => void;
}) {
  const isEditing = !!entry;
  const supabase = createClient();
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [content, setContent] = useState(entry?.content ?? "");
  const [workDate, setWorkDate] = useState(
    entry?.work_date ?? brisbaneDateISO()
  );
  const [callOut, setCallOut] = useState(entry?.call_out ?? false);
  const [labourHours, setLabourHours] = useState(entry?.labour_hours?.toString() ?? "");
  const [materials, setMaterials] = useState<{ product_id?: string; name: string; sku?: string; qty: number }[]>(
    entry?.materials ?? []
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [showQuickLines, setShowQuickLines] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  // Auto-save bookkeeping. entryIdRef lets a new entry flip to update mode after
  // its first create; savingRef serialises saves; dirtyRef re-runs if a change
  // landed mid-save; mountedRef skips the initial render of an existing entry.
  const entryIdRef = useRef<string | null>(entry?.id ?? null);
  const savedImageUrlsRef = useRef<string[]>(entry?.image_urls ?? []);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(false);
  // True while a debounce timer is armed — the unmount/hide flush uses this to
  // know there are keystrokes the timer hasn't persisted yet.
  const pendingRef = useRef(false);

  // Material management — product catalog selector
  const [productCatalog, setProductCatalog] = useState<{ id: string; name: string; sku: string; category: string }[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  // Load product catalog on first open
  if (!catalogLoaded) {
    setCatalogLoaded(true);
    supabase
      .from("quote_products")
      .select("id, name, sku, category")
      .eq("is_active", true)
      .order("category, name")
      .then(({ data }) => setProductCatalog(data ?? []));
  }

  const filteredCatalog = useMemo(() => {
    if (!productSearch || productSearch.length < 1) return [];
    const q = productSearch.toLowerCase();
    return productCatalog.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }, [productCatalog, productSearch]);

  // One-tap chip add: same product tapped twice just bumps qty.
  function addOrBumpMaterial(productId: string) {
    const product = productCatalog.find(p => p.id === productId);
    if (!product) return;
    setMaterials((prev) => {
      const existing = prev.findIndex(m => m.product_id === productId);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing], qty: next[existing].qty + 1 };
        return next;
      }
      return [...prev, {
        product_id: product.id,
        name: product.name,
        sku: product.sku || undefined,
        qty: 1,
      }];
    });
  }

  function bumpMaterial(index: number, delta: number) {
    setMaterials((prev) => {
      const next = [...prev];
      const newQty = (next[index]?.qty ?? 0) + delta;
      if (newQty <= 0) return prev.filter((_, i) => i !== index);
      next[index] = { ...next[index], qty: newQty };
      return next;
    });
  }

  function removeMaterial(index: number) {
    setMaterials(materials.filter((_, i) => i !== index));
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setSelectedFiles((prev) => [...prev, ...files]);
    const newPreviews = files.filter((f) => f.type.startsWith("image/")).map((f) => URL.createObjectURL(f));
    setPreviews((prev) => [...prev, ...newPreviews]);
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  function insertQuickLine(line: string) {
    // Substitute __:__ placeholders with the current local time (HH:MM).
    // Tech taps a line like "Arrived on site at __:__" and gets it pre-filled.
    const now = new Date();
    const hhmm = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    const filled = line.replace(/__:__/g, hhmm);
    const newContent = content ? content.trimEnd() + "\n" + filled : filled;
    setContent(newContent);
    setShowQuickLines(false);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = newContent.length;
        textareaRef.current.selectionEnd = newContent.length;
      }
    }, 0);
  }

  // Keep the latest field values in a ref so the auto-save always reads current
  // state — timers/promises fire after re-renders, so a closure would be stale.
  const latest = useRef({ content, workDate, callOut, labourHours, materials, selectedFiles });
  latest.current = { content, workDate, callOut, labourHours, materials, selectedFiles };

  async function persist() {
    if (savingRef.current) return; // a save is in flight; dirtyRef will re-run it
    const v = latest.current;
    if (!v.content.trim() && !entryIdRef.current) return; // never create an empty entry
    savingRef.current = true;
    dirtyRef.current = false;
    setSaveState("saving");
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Upload any pending photos (the photo button is disabled while saving,
      // so nothing new arrives mid-upload).
      let newUrls: string[] = [];
      if (v.selectedFiles.length > 0) {
        let done = 0;
        setUploadProgress({ done: 0, total: v.selectedFiles.length });
        const uploaded = await mapWithConcurrency(v.selectedFiles, 4, async (file) => {
          const prepped = await compressImage(file);
          const ext = prepped.name.split(".").pop();
          const path = `${jobId}/work/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { data, error } = await supabase.storage.from("job-attachments").upload(path, prepped);
          done++;
          setUploadProgress({ done, total: v.selectedFiles.length });
          if (error || !data) return null;
          // Bucket is private — same-origin authenticated proxy serves it.
          return `/api/attachments/${data.path}`;
        });
        newUrls = uploaded.filter((u): u is string => !!u);
        setUploadProgress(null);
        setSelectedFiles([]);
        setPreviews([]);
      }

      const allImages = [...savedImageUrlsRef.current, ...newUrls];
      savedImageUrlsRef.current = allImages;

      const payload = {
        content: v.content.trim(),
        work_date: v.workDate,
        call_out: v.callOut,
        labour_hours: v.labourHours ? parseFloat(v.labourHours) : null,
        materials: v.materials,
        image_urls: allImages,
      };

      if (entryIdRef.current) {
        const { error } = await supabase.from("job_work_entries").update(payload).eq("id", entryIdRef.current);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("job_work_entries")
          .insert({ ...payload, job_id: jobId, staff_id: user?.id ?? null })
          .select("id")
          .single();
        if (error) throw error;
        entryIdRef.current = data.id;
        await autoTransitionJobStatus(jobId, "work_started", supabase);
      }
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      toast(err instanceof Error ? err.message : "Auto-save failed", "error");
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) void persist(); // a change landed during the save — flush it
    }
  }

  // Debounced auto-save on any field change. Skips the first render so opening
  // an existing entry doesn't immediately re-save it.
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (!content.trim() && !entryIdRef.current) return;
    pendingRef.current = true;
    const t = setTimeout(() => { pendingRef.current = false; dirtyRef.current = true; void persist(); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, workDate, callOut, labourHours, materials]);

  // Photos: upload + save shortly after they're added.
  useEffect(() => {
    if (selectedFiles.length === 0) return;
    pendingRef.current = true;
    const t = setTimeout(() => { pendingRef.current = false; dirtyRef.current = true; void persist(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFiles]);

  // Flush, don't drop. The debounce cleanups above CANCEL an armed timer, and
  // this form unmounts on any tab switch or navigation — so the last <800ms of
  // typing (or an entire brand-new entry typed quickly) was silently lost
  // (Michael 2026-07-30). Unmount and page-hide now run the save the timer
  // would have. persist() reads latest.current, so the values are current even
  // though the flush fires from a cleanup.
  useEffect(() => {
    const flush = () => {
      if (!pendingRef.current && !dirtyRef.current) return;
      pendingRef.current = false;
      dirtyRef.current = true;
      void persist();
    };
    const onVisibility = () => { if (document.hidden) flush(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDone() {
    await persist();
    onSaved();
  }

  const inputClass = "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="mb-5 rounded-lg border border-primary/30 bg-card p-4 space-y-3">
      {/* Date — iOS Safari date inputs have an intrinsic min-width that
          can overflow the parent. min-w-0 + max-w-full clamps it. */}
      <div className="min-w-0">
        <label className="block text-xs font-medium text-muted-foreground mb-1">Date</label>
        <input
          type="date"
          value={workDate}
          onChange={(e) => setWorkDate(e.target.value)}
          className={`${inputClass} min-w-0 max-w-full`}
        />
      </div>

      {/* Work description */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={8}
        autoFocus={!isEditing}
        placeholder={"What work was completed?\nOne line per task..."}
        className={`${inputClass} resize-y font-mono leading-relaxed`}
      />

      {/* Quick lines */}
      <div className="relative">
        <button type="button" onClick={() => setShowQuickLines(!showQuickLines)} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors">
          <ZapIcon className="h-3.5 w-3.5" /> Quick Insert
        </button>
        {showQuickLines && (
          <div className="absolute left-0 bottom-full z-50 mb-1 w-80 max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
            {QUICK_LINES.map((line, i) => (
              <button key={i} type="button" onClick={() => insertQuickLine(line)} className="block w-full px-3 py-2 text-left text-xs hover:bg-accent transition-colors border-b border-border last:border-0">
                {line}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Materials — chip-picker: tap to add, tap again to bump qty. */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Materials Used</label>
        {materials.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {materials.map((m, i) => (
              <span key={i} className={`inline-flex items-center gap-0.5 rounded-md text-xs ${m.product_id ? "bg-primary/10 text-primary" : "bg-muted"}`}>
                <button
                  type="button"
                  onClick={() => bumpMaterial(i, -1)}
                  className="px-1.5 py-1 text-muted-foreground hover:text-foreground"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="px-1 font-medium">{m.qty}×</span>
                <span className="pr-1">{m.name}</span>
                {m.sku && <span className="font-mono text-[10px] opacity-60 pr-1">{m.sku}</span>}
                <button
                  type="button"
                  onClick={() => bumpMaterial(i, 1)}
                  className="px-1.5 py-1 text-muted-foreground hover:text-foreground"
                  aria-label="Increase quantity"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => removeMaterial(i)}
                  className="px-1.5 py-1 text-muted-foreground hover:text-destructive"
                  aria-label="Remove"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          type="text"
          value={productSearch}
          onChange={(e) => setProductSearch(e.target.value)}
          placeholder="Search products to add…"
          className={`${inputClass} text-base sm:text-sm`}
        />
        {productSearch.length >= 1 && (
          <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-border bg-card/50">
            {filteredCatalog.slice(0, 30).map((p) => {
              const inCart = materials.find((m) => m.product_id === p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addOrBumpMaterial(p.id)}
                  className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-accent transition-colors"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{p.name}</span>
                    {p.sku && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{p.sku}</span>}
                    <span className="ml-1.5 text-[10px] text-muted-foreground">{p.category}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {inCart ? `${inCart.qty}× — tap +1` : "+ Add"}
                  </span>
                </button>
              );
            })}
            {filteredCatalog.length === 0 && (
              <div className="px-3 py-3 text-xs text-muted-foreground">No matches.</div>
            )}
          </div>
        )}
      </div>

      {/* Labour + Call Out */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Labour Hours</label>
          <input type="number" value={labourHours} onChange={(e) => setLabourHours(e.target.value)} step="0.5" min="0" placeholder="0" className={`${inputClass} w-24`} />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <button
            type="button"
            onClick={() => setCallOut(!callOut)}
            className={`relative h-5 w-9 rounded-full transition-colors ${callOut ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${callOut ? "left-[18px]" : "left-0.5"}`} />
          </button>
          <span className="text-sm text-muted-foreground">Call Out</span>
        </div>
      </div>

      {/* Photo previews */}
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {previews.map((url, i) => (
            <div key={i} className="relative">
              <img src={url} alt="" loading="lazy" decoding="async" className="h-20 w-20 rounded-md border border-border object-cover" />
              <button type="button" onClick={() => removeFile(i)} className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] text-white">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Photos attach button — sits above the action row so the Save
          button never gets pushed off-screen when the form is wide. */}
      <div className="pt-1">
        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileSelect} className="hidden" />
        <button type="button" disabled={saveState === "saving"} onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-foreground disabled:opacity-50 transition-colors">
          <CameraIcon className="h-3.5 w-3.5" /> Photos
        </button>
      </div>
      {/* Actions — entry auto-saves; the status shows where it's at and Done
          closes the form (flushing any final save first). */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-border">
        <span className="text-xs text-muted-foreground">
          {uploadProgress
            ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…`
            : saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved ✓"
                : saveState === "error"
                  ? "Save failed — will retry on next change"
                  : "Saves automatically"}
        </span>
        <button type="button" onClick={handleDone} className="w-full sm:w-auto rounded-md bg-primary px-5 py-2.5 sm:py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
          Done
        </button>
      </div>
    </div>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>;
}

function ZapIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>;
}
