"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { Staff, StaffRole } from "@/lib/types";
import { StaffNotificationEditor } from "./staff-notification-editor";

interface NotificationType {
  code: string;
  label: string;
  category: string;
  description: string | null;
  default_enabled: boolean;
  email_enabled: boolean;
  priority: string;
  sort_order: number;
}

interface PrefRow {
  type_code: string;
  enabled: boolean;
  email_enabled: boolean | null;
}

const roleLabels: Record<StaffRole, string> = {
  admin: "Admin",
  finance_manager: "Finance Manager",
  project_manager: "Project Manager",
  field_staff: "Field Staff",
};

const roleColours: Record<StaffRole, string> = {
  admin: "#ef4444",
  finance_manager: "#f59e0b",
  project_manager: "#3b82f6",
  field_staff: "#22c55e",
};

const staffColours = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
];

export function StaffList({
  staff,
  isAdmin,
  currentUserId,
  notificationTypes,
  prefsByStaff,
}: {
  staff: Staff[];
  isAdmin: boolean;
  currentUserId: string;
  notificationTypes: NotificationType[];
  prefsByStaff: Record<string, PrefRow[]>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notifsOpenId, setNotifsOpenId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  return (
    <div className="space-y-3 max-w-2xl">
      {isAdmin && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowInvite(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            + Invite teammate
          </button>
        </div>
      )}
      {showInvite && (
        <InviteForm onDone={() => setShowInvite(false)} />
      )}
      {staff.map((member) => (
        <div key={member.id}>
          {editingId === member.id ? (
            <StaffEditForm
              member={member}
              onDone={() => setEditingId(null)}
            />
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: member.colour }}
                >
                  {member.initials}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{member.display_name}</span>
                    {member.id === currentUserId && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                        You
                      </span>
                    )}
                    {!member.is_active && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: `${roleColours[member.role]}20`,
                        color: roleColours[member.role],
                      }}
                    >
                      {roleLabels[member.role]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {member.email}
                    </span>
                  </div>
                  {member.phone && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {member.phone}
                    </p>
                  )}
                </div>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setNotifsOpenId(notifsOpenId === member.id ? null : member.id)}
                    className={`text-xs transition-colors ${notifsOpenId === member.id ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {notifsOpenId === member.id ? "Close notifications" : "Notifications"}
                  </button>
                  <button
                    onClick={() => setEditingId(member.id)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Edit
                  </button>
                  {member.id !== currentUserId && (
                    <DeleteStaffButton member={member} />
                  )}
                </div>
              )}
            </div>
          )}
          {isAdmin && notifsOpenId === member.id && (
            <div className="rounded-b-lg border border-t-0 border-border overflow-hidden -mt-1">
              <StaffNotificationEditor
                staffId={member.id}
                staffName={member.display_name}
                types={notificationTypes}
                initialPrefs={prefsByStaff[member.id] ?? []}
              />
            </div>
          )}
        </div>
      ))}
      {staff.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No staff members yet. Click "Invite teammate" to send your first invitation.
        </p>
      )}
    </div>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [initials, setInitials] = useState("");
  const [role, setRole] = useState<StaffRole>("field_staff");
  const [phone, setPhone] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !displayName.trim()) {
      toast("Email and name are required", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/staff/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          display_name: displayName.trim(),
          initials: initials.trim() || null,
          role,
          phone: phone.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invite failed");
      toast(`Invitation sent to ${email.trim()}`);
      onDone();
      router.refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Invite failed", "error");
    }
    setBusy(false);
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-primary/30 bg-card p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Invite teammate</p>
        <button
          type="button"
          onClick={onDone}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Creates the account and emails a temporary password from <span className="font-mono text-foreground">noreply@centrefit.com.au</span>. They sign in with email + password and change it from their account.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="name@example.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground">Display name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground">Initials</label>
          <input
            value={initials}
            onChange={(e) => setInitials(e.target.value)}
            maxLength={3}
            className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm uppercase focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="auto"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="field_staff">Field Staff</option>
            <option value="project_manager">Project Manager</option>
            <option value="finance_manager">Finance Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground">Phone</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="04XX XXX XXX"
          />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Sending..." : "Send invitation"}
        </button>
      </div>
    </form>
  );
}

function StaffEditForm({
  member,
  onDone,
}: {
  member: Staff;
  onDone: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState(member.display_name);
  const [initials, setInitials] = useState(member.initials);
  const [colour, setColour] = useState(member.colour);
  const [role, setRole] = useState<StaffRole>(member.role);
  const [phone, setPhone] = useState(member.phone ?? "");
  const [isActive, setIsActive] = useState(member.is_active);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const { error } = await supabase
      .from("staff")
      .update({
        display_name: displayName.trim(),
        initials: initials.trim().toUpperCase(),
        colour,
        role,
        phone: phone.trim() || null,
        is_active: isActive,
      })
      .eq("id", member.id);

    if (error) {
      toast(error.message, "error");
    } else {
      onDone();
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <form
      onSubmit={handleSave}
      className="rounded-lg border border-primary/30 bg-card p-4 space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground">
            Display Name
          </label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground">
            Initials
          </label>
          <input
            value={initials}
            onChange={(e) => setInitials(e.target.value)}
            maxLength={3}
            required
            className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm uppercase focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground">
            Role
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {Object.entries(roleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground">
            Phone
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="04XX XXX XXX"
          />
        </div>
      </div>

      {/* Colour picker */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
          Colour
        </label>
        <div className="flex gap-2">
          {staffColours.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColour(c)}
              className={`h-7 w-7 rounded-full transition-transform ${
                colour === c ? "ring-2 ring-primary ring-offset-2 ring-offset-card scale-110" : "hover:scale-110"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="rounded border-border accent-primary"
        />
        Active
      </label>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeleteStaffButton({ member }: { member: Staff }) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/staff/${member.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      toast(`Removed ${member.display_name}`);
      router.refresh();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
    setBusy(false);
    setConfirming(false);
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-xs text-muted-foreground hover:text-destructive transition-colors"
      >
        Delete
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">Delete?</span>
      <button
        onClick={handleDelete}
        disabled={busy}
        className="rounded-md bg-destructive px-2 py-1 text-[11px] font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
      >
        {busy ? "..." : "Yes"}
      </button>
      <button
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
