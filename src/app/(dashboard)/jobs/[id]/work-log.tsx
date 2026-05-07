"use client";

import { useState, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { autoTransitionJobStatus } from "@/lib/job-status-transitions";

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
  const router = useRouter();

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

  return (
    <div>
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
          onClose={closeForm}
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
              {/* Header */}
              <div className="flex items-center justify-between bg-muted/50 px-4 py-2 border-b border-border">
                <div className="flex items-center gap-2">
                  {entry.staff && (
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium text-white"
                      style={{ backgroundColor: entry.staff.colour ?? "#3b82f6" }}
                    >
                      {entry.staff.initials}
                    </span>
                  )}
                  <span className="text-sm font-medium">
                    {entry.staff?.display_name ?? "Unknown"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {/* Billing badges */}
                  {entry.call_out && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      Call Out
                    </span>
                  )}
                  {entry.labour_hours != null && entry.labour_hours > 0 && (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                      {entry.labour_hours}h labour
                    </span>
                  )}
                  <span className="text-xs font-medium text-muted-foreground">
                    {new Date(entry.work_date + "T00:00:00").toLocaleDateString(
                      "en-AU",
                      { weekday: "short", day: "numeric", month: "short", year: "numeric" }
                    )}
                  </span>
                  <button
                    onClick={() => openEdit(entry)}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    Edit
                  </button>
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
                      <img src={url} alt="" className="h-20 w-auto rounded-md border border-border object-cover hover:opacity-90 transition-opacity" />
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
  onClose,
  onSaved,
}: {
  jobId: string;
  entry: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEditing = !!entry;
  const supabase = createClient();
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [content, setContent] = useState(entry?.content ?? "");
  const [workDate, setWorkDate] = useState(
    entry?.work_date ?? new Date().toISOString().split("T")[0]
  );
  const [callOut, setCallOut] = useState(entry?.call_out ?? false);
  const [labourHours, setLabourHours] = useState(entry?.labour_hours?.toString() ?? "");
  const [materials, setMaterials] = useState<{ product_id?: string; name: string; sku?: string; qty: number }[]>(
    entry?.materials ?? []
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [showQuickLines, setShowQuickLines] = useState(false);
  const [saving, setSaving] = useState(false);

  // Material management — product catalog selector
  const [newMaterialQty, setNewMaterialQty] = useState("1");
  const [selectedProductId, setSelectedProductId] = useState("");
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
    if (!productSearch || productSearch.length < 2) return productCatalog;
    const q = productSearch.toLowerCase();
    return productCatalog.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }, [productCatalog, productSearch]);

  // Group by category for display
  const catalogByCategory = useMemo(() => {
    const map = new Map<string, typeof productCatalog>();
    for (const p of filteredCatalog) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return map;
  }, [filteredCatalog]);

  function addMaterial() {
    if (!selectedProductId) return;
    const product = productCatalog.find(p => p.id === selectedProductId);
    if (!product) return;
    setMaterials([...materials, {
      product_id: product.id,
      name: product.name,
      sku: product.sku || undefined,
      qty: parseInt(newMaterialQty) || 1,
    }]);
    setSelectedProductId("");
    setNewMaterialQty("1");
    setProductSearch("");
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
    const newContent = content ? content.trimEnd() + "\n" + line : line;
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();

    // Upload new photos
    const newImageUrls: string[] = [];
    for (const file of selectedFiles) {
      const ext = file.name.split(".").pop();
      const path = `${jobId}/work/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { data, error } = await supabase.storage.from("job-attachments").upload(path, file);
      if (!error && data) {
        const { data: urlData } = supabase.storage.from("job-attachments").getPublicUrl(data.path);
        newImageUrls.push(urlData.publicUrl);
      }
    }

    const payload = {
      content: content.trim(),
      work_date: workDate,
      call_out: callOut,
      labour_hours: labourHours ? parseFloat(labourHours) : null,
      materials,
      image_urls: isEditing
        ? [...(entry.image_urls ?? []), ...newImageUrls]
        : newImageUrls,
    };

    if (isEditing) {
      const { error } = await supabase.from("job_work_entries").update(payload).eq("id", entry.id);
      if (error) { toast(error.message, "error"); setSaving(false); return; }
      toast("Entry updated");
    } else {
      const { error } = await supabase.from("job_work_entries").insert({
        ...payload,
        job_id: jobId,
        staff_id: user?.id ?? null,
      });
      if (error) { toast(error.message, "error"); setSaving(false); return; }
      toast("Entry saved");
      await autoTransitionJobStatus(jobId, "work_started", supabase);
    }

    onSaved();
  }

  const inputClass = "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <form onSubmit={handleSubmit} className="mb-5 rounded-lg border border-primary/30 bg-card p-4 space-y-3">
      {/* Date */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Date</label>
        <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className={inputClass} />
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

      {/* Materials */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Materials Used</label>
        {materials.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {materials.map((m, i) => (
              <span key={i} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${m.product_id ? "bg-primary/10 text-primary" : "bg-muted"}`}>
                {m.qty}x {m.name}
                {m.sku && <span className="font-mono text-[10px] opacity-70">{m.sku}</span>}
                {m.product_id && <span className="text-[9px] opacity-60">linked</span>}
                <button type="button" onClick={() => removeMaterial(i)} className="text-muted-foreground hover:text-destructive ml-1">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Filter products..."
              className={`${inputClass} mb-1.5 text-base sm:text-sm`}
            />
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className={`${inputClass} text-base sm:text-sm`}
              size={6}
            >
              <option value="">— Select a product —</option>
              {Array.from(catalogByCategory).map(([category, items]) => (
                <optgroup key={category} label={category}>
                  {items.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.sku ? ` (${p.sku})` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          {/* On mobile: qty + Add stack horizontally below the picker, both
              spread to full width so they're thumb-reachable. Desktop keeps
              the existing column-on-the-right layout. */}
          <div className="flex flex-row sm:flex-col items-end sm:items-stretch gap-2 sm:gap-1.5 sm:shrink-0">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground">Qty</label>
              <input
                type="number"
                value={newMaterialQty}
                onChange={(e) => setNewMaterialQty(e.target.value)}
                min="1"
                className={`${inputClass} w-20 sm:w-16 text-center text-base sm:text-sm`}
              />
            </div>
            <button
              type="button"
              onClick={addMaterial}
              disabled={!selectedProductId}
              className="flex-1 sm:flex-none rounded-md bg-primary px-4 py-3 sm:py-2 text-sm sm:text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-30 transition-colors"
            >
              Add
            </button>
          </div>
        </div>
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
              <img src={url} alt="" className="h-20 w-20 rounded-md border border-border object-cover" />
              <button type="button" onClick={() => removeFile(i)} className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] text-white">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileSelect} className="hidden" />
        <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors">
          <CameraIcon className="h-3.5 w-3.5" /> Photos
        </button>
        <div className="flex-1" />
        <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors">Cancel</button>
        <button type="submit" disabled={saving || !content.trim()} className="rounded-md bg-primary px-5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {saving ? "Saving..." : isEditing ? "Save Changes" : "Save Entry"}
        </button>
      </div>
    </form>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>;
}

function ZapIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>;
}
