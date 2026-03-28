"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { Staff, StaffRole } from "@/lib/types";

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
}: {
  staff: Staff[];
  isAdmin: boolean;
  currentUserId: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-3 max-w-2xl">
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
                <button
                  onClick={() => setEditingId(member.id)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Edit
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {staff.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No staff members. Create users in Supabase Auth to add team members.
        </p>
      )}
    </div>
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
      alert(error.message);
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
