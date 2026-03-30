"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { autoTransitionJobStatus } from "@/lib/job-status-transitions";
import type { Category, Status } from "@/lib/types";

const inputClass =
  "mt-1 block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

interface CustomerOption {
  id: string;
  name: string;
  customer_sites: { id: string; name: string }[];
}

interface StaffOption {
  id: string;
  display_name: string;
  initials: string;
  colour: string;
}

interface Prefill {
  fromDealId: string;
  customerId?: string;
  reference?: string;
  description?: string;
}

interface JobFormProps {
  customers: CustomerOption[];
  categories: Category[];
  statuses: Status[];
  staff: StaffOption[];
  prefill?: Prefill;
}

export function JobForm({
  customers,
  categories,
  statuses,
  staff,
  prefill,
}: JobFormProps) {
  const router = useRouter();
  const supabase = createClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [customerId, setCustomerId] = useState(prefill?.customerId ?? "");
  const [siteId, setSiteId] = useState("");
  const [reference, setReference] = useState(prefill?.reference ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [category1Id, setCategory1Id] = useState("");
  const [category2Id, setCategory2Id] = useState("");
  const [statusId, setStatusId] = useState(
    statuses.find((s) => s.name === "Lead / Unassigned")?.id ?? ""
  );
  const [selectedStaff, setSelectedStaff] = useState<string[]>([]);
  const [showStaffPicker, setShowStaffPicker] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const jobTypes = categories.filter((c) => c.type === "job_type");
  const businessUnits = categories.filter((c) => c.type === "business_unit");

  // Unified search across customer names AND site names
  const searchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase();
    const results: { customerId: string; customerName: string; siteId?: string; siteName?: string; label: string }[] = [];

    for (const customer of customers) {
      // Match customer name
      if (customer.name.toLowerCase().includes(q)) {
        results.push({
          customerId: customer.id,
          customerName: customer.name,
          label: customer.name,
        });
      }
      // Match site names
      for (const site of customer.customer_sites) {
        if (site.name.toLowerCase().includes(q)) {
          results.push({
            customerId: customer.id,
            customerName: customer.name,
            siteId: site.id,
            siteName: site.name,
            label: `${site.name}`,
          });
        }
      }
    }
    return results.slice(0, 20);
  }, [customers, searchQuery]);

  // Get display text for selected customer/site
  const selectedCustomer = customers.find((c) => c.id === customerId);
  const selectedSite = selectedCustomer?.customer_sites.find((s) => s.id === siteId);
  const sites = selectedCustomer?.customer_sites ?? [];

  // Group statuses by phase
  const statusesByPhase = useMemo(() => {
    const grouped: Record<string, Status[]> = {};
    for (const s of statuses) {
      if (!grouped[s.phase]) grouped[s.phase] = [];
      grouped[s.phase].push(s);
    }
    return grouped;
  }, [statuses]);

  const phaseLabels: Record<string, string> = {
    pre_work: "Pre-Work",
    quoting: "Quoting",
    in_progress: "In Progress",
    tracking_hold: "Tracking & Hold",
    completion: "Completion",
  };

  function selectResult(result: typeof searchResults[0]) {
    setCustomerId(result.customerId);
    setSiteId(result.siteId ?? "");
    setSearchQuery("");
  }

  function clearSelection() {
    setCustomerId("");
    setSiteId("");
    setSearchQuery("");
  }

  function toggleStaff(staffId: string) {
    setSelectedStaff((prev) =>
      prev.includes(staffId)
        ? prev.filter((id) => id !== staffId)
        : [...prev, staffId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    if (!customerId) {
      setError("Customer is required");
      setSaving(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: newJob, error: err } = await supabase
      .from("jobs")
      .insert({
        customer_id: customerId,
        site_id: siteId || null,
        reference: reference.trim() || null,
        description: description.trim() || null,
        category_1_id: category1Id || null,
        category_2_id: category2Id || null,
        status_id: statusId,
        created_by: user?.id ?? null,
      })
      .select()
      .single();

    if (err || !newJob) {
      setError(err?.message ?? "Failed to create job");
      setSaving(false);
      return;
    }

    if (selectedStaff.length > 0) {
      await supabase.from("job_staff").insert(
        selectedStaff.map((staffId) => ({
          job_id: newJob.id,
          staff_id: staffId,
        }))
      );
      await autoTransitionJobStatus(newJob.id, "staff_assigned", supabase);
    }

    // Link the pipeline deal to this job and archive it off the board
    if (prefill?.fromDealId) {
      await supabase
        .from("pipeline_deals")
        .update({ won_job_id: newJob.id, stage: "accepted" })
        .eq("id", prefill.fromDealId);
    }

    router.push(`/jobs/${newJob.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Customer / Site Search */}
      <div>
        <label className="block text-sm font-medium">
          Customer / Site <span className="text-destructive">*</span>
        </label>

        {customerId ? (
          <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
            <div className="flex-1">
              <span className="text-sm font-medium">
                {selectedCustomer?.name}
              </span>
              {selectedSite && (
                <span className="text-sm text-muted-foreground">
                  {" "}— {selectedSite.name}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              placeholder="Search by customer name or site name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              className={inputClass}
            />
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
                {searchResults.map((result, i) => (
                  <button
                    key={`${result.customerId}-${result.siteId ?? "no-site"}-${i}`}
                    type="button"
                    onClick={() => selectResult(result)}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent transition-colors border-b border-border last:border-0"
                  >
                    <div>
                      {result.siteName ? (
                        <>
                          <span className="font-medium">{result.siteName}</span>
                          <span className="block text-xs text-muted-foreground">
                            Customer: {result.customerName}
                          </span>
                        </>
                      ) : (
                        <span className="font-medium">{result.customerName}</span>
                      )}
                    </div>
                    {result.siteName && (
                      <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        Site
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {searchQuery.length >= 2 && searchResults.length === 0 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-border bg-card px-3 py-3 text-sm text-muted-foreground shadow-xl">
                No customers or sites found
              </div>
            )}
          </div>
        )}

        {/* Site picker if customer selected but no site picked via search */}
        {customerId && !siteId && sites.length > 0 && (
          <div className="mt-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Select site
            </label>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className={inputClass}
            >
              <option value="">No specific site</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Reference */}
      <div>
        <label className="block text-sm font-medium">Reference</label>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className={inputClass}
          placeholder="PO number, brief title, or job reference"
        />
      </div>

      {/* Description — big and prominent */}
      <div>
        <label className="block text-sm font-medium">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={8}
          className={`${inputClass} resize-y`}
          placeholder="Scope of work, key details, special instructions..."
        />
      </div>

      {/* Categories & Status */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium">Job Type</label>
          <select
            value={category1Id}
            onChange={(e) => setCategory1Id(e.target.value)}
            className={inputClass}
          >
            <option value="">Select type</option>
            {jobTypes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Business Unit</label>
          <select
            value={category2Id}
            onChange={(e) => setCategory2Id(e.target.value)}
            className={inputClass}
          >
            <option value="">Select unit</option>
            {businessUnits.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Status</label>
          <select
            value={statusId}
            onChange={(e) => setStatusId(e.target.value)}
            className={inputClass}
          >
            {Object.entries(statusesByPhase).map(([phase, phaseStatuses]) => (
              <optgroup key={phase} label={phaseLabels[phase] ?? phase}>
                {phaseStatuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {/* Staff Assignment */}
      <div>
        <label className="block text-sm font-medium mb-2">Assign Staff</label>
        <div className="flex flex-wrap items-center gap-2">
          {selectedStaff.map((id) => {
            const member = staff.find((s) => s.id === id);
            if (!member) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-sm"
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white"
                  style={{ backgroundColor: member.colour }}
                >
                  {member.initials}
                </span>
                {member.display_name}
                <button
                  type="button"
                  onClick={() => toggleStaff(id)}
                  className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
                >
                  ×
                </button>
              </span>
            );
          })}

          {/* + button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowStaffPicker(!showStaffPicker)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >
              +
            </button>
            {showStaffPicker && (
              <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
                {staff
                  .filter((s) => !selectedStaff.includes(s.id))
                  .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        toggleStaff(s.id);
                        setShowStaffPicker(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white"
                        style={{ backgroundColor: s.colour }}
                      >
                        {s.initials}
                      </span>
                      {s.display_name}
                    </button>
                  ))}
                {staff.filter((s) => !selectedStaff.includes(s.id)).length ===
                  0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    All staff assigned
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 border-t border-border pt-5">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create Job"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
