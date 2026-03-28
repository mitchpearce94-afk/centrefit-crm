"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
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

interface JobFormProps {
  customers: CustomerOption[];
  categories: Category[];
  statuses: Status[];
  staff: StaffOption[];
  job?: any;
}

export function JobForm({
  customers,
  categories,
  statuses,
  staff,
  job,
}: JobFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const isEditing = !!job;

  const [customerId, setCustomerId] = useState(job?.customer_id ?? "");
  const [siteId, setSiteId] = useState(job?.site_id ?? "");
  const [reference, setReference] = useState(job?.reference ?? "");
  const [description, setDescription] = useState(job?.description ?? "");
  const [category1Id, setCategory1Id] = useState(job?.category_1_id ?? "");
  const [category2Id, setCategory2Id] = useState(job?.category_2_id ?? "");
  const [statusId, setStatusId] = useState(
    job?.status_id ?? statuses.find((s) => s.name === "Lead / Unassigned")?.id ?? ""
  );
  const [estimatedValue, setEstimatedValue] = useState(
    job?.estimated_value?.toString() ?? ""
  );
  const [dueDate, setDueDate] = useState(job?.due_date ?? "");
  const [selectedStaff, setSelectedStaff] = useState<string[]>(
    job?.job_staff?.map((js: any) => js.staff_id) ?? []
  );
  const [customerSearch, setCustomerSearch] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const jobTypes = categories.filter((c) => c.type === "job_type");
  const businessUnits = categories.filter((c) => c.type === "business_unit");

  // Get sites for selected customer
  const selectedCustomer = customers.find((c) => c.id === customerId);
  const sites = selectedCustomer?.customer_sites ?? [];

  // Filter customers by search
  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers;
    const q = customerSearch.toLowerCase();
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, customerSearch]);

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
    if (!statusId) {
      setError("Status is required");
      setSaving(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const payload: Record<string, any> = {
      customer_id: customerId,
      site_id: siteId || null,
      reference: reference.trim() || null,
      description: description.trim() || null,
      category_1_id: category1Id || null,
      category_2_id: category2Id || null,
      status_id: statusId,
      estimated_value: estimatedValue ? parseFloat(estimatedValue) : null,
      due_date: dueDate || null,
    };

    if (!isEditing && user) {
      payload.created_by = user.id;
    }

    if (isEditing) {
      const { error: err } = await supabase
        .from("jobs")
        .update(payload)
        .eq("id", job.id);

      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }

      // Update staff assignments
      await supabase.from("job_staff").delete().eq("job_id", job.id);
      if (selectedStaff.length > 0) {
        await supabase.from("job_staff").insert(
          selectedStaff.map((staffId) => ({
            job_id: job.id,
            staff_id: staffId,
          }))
        );
      }

      router.push(`/jobs/${job.id}`);
      router.refresh();
    } else {
      const { data: newJob, error: err } = await supabase
        .from("jobs")
        .insert(payload)
        .select()
        .single();

      if (err || !newJob) {
        setError(err?.message ?? "Failed to create job");
        setSaving(false);
        return;
      }

      // Add staff assignments
      if (selectedStaff.length > 0) {
        await supabase.from("job_staff").insert(
          selectedStaff.map((staffId) => ({
            job_id: newJob.id,
            staff_id: staffId,
          }))
        );
      }

      router.push(`/jobs/${newJob.id}`);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Customer Selection */}
      <div>
        <label className="block text-sm font-medium">
          Customer <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          placeholder="Search customers..."
          value={
            customerId
              ? customers.find((c) => c.id === customerId)?.name ?? customerSearch
              : customerSearch
          }
          onChange={(e) => {
            setCustomerSearch(e.target.value);
            if (customerId) {
              setCustomerId("");
              setSiteId("");
            }
          }}
          className={inputClass}
        />
        {customerSearch && !customerId && (
          <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-card">
            {filteredCustomers.slice(0, 20).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCustomerId(c.id);
                  setCustomerSearch("");
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
              >
                {c.name}
              </button>
            ))}
            {filteredCustomers.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No customers found
              </div>
            )}
          </div>
        )}

        {/* Site selection — only if customer has sites */}
        {customerId && sites.length > 0 && (
          <div className="mt-3">
            <label className="block text-sm font-medium">Site</label>
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

      {/* Reference & Description */}
      <div className="space-y-3 border-t border-border pt-5">
        <div>
          <label className="block text-sm font-medium">Reference</label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={inputClass}
            placeholder="e.g. PO-12345 or brief title"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={`${inputClass} resize-none`}
            placeholder="Scope of work, key details..."
          />
        </div>
      </div>

      {/* Categories & Status */}
      <div className="space-y-3 border-t border-border pt-5">
        <div className="grid grid-cols-2 gap-4">
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">
              Estimated Value
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
              className={inputClass}
              placeholder="$0.00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Staff Assignment */}
      <div className="border-t border-border pt-5">
        <label className="block text-sm font-medium mb-2">Assign Staff</label>
        <div className="flex flex-wrap gap-2">
          {staff.map((s) => {
            const isSelected = selectedStaff.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleStaff(s.id)}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors border ${
                  isSelected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                }`}
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white"
                  style={{ backgroundColor: s.colour }}
                >
                  {s.initials}
                </span>
                {s.display_name}
              </button>
            );
          })}
          {staff.length === 0 && (
            <span className="text-sm text-muted-foreground">
              No staff members yet
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 border-t border-border pt-5">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving
            ? "Saving..."
            : isEditing
              ? "Update Job"
              : "Create Job"}
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
