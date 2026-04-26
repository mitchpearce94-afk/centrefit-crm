"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

interface Staff {
  id: string;
  display_name: string;
  initials: string;
  email: string;
  role: string;
  phone: string | null;
  colour: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  finance_manager: "Finance Manager",
  project_manager: "Project Manager",
  field_staff: "Field Staff",
};

export function AccountForm({ staff }: { staff: Staff | null }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();

  const [displayName, setDisplayName] = useState(staff?.display_name ?? "");
  const [phone, setPhone] = useState(staff?.phone ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  if (!staff) {
    return <p className="text-sm text-muted-foreground">No profile found.</p>;
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) {
      toast("Display name is required", "error");
      return;
    }
    setSavingProfile(true);
    const { error } = await supabase
      .from("staff")
      .update({
        display_name: displayName.trim(),
        phone: phone.trim() || null,
      })
      .eq("id", staff!.id);
    setSavingProfile(false);
    if (error) {
      toast(error.message, "error");
    } else {
      toast("Profile updated");
      router.refresh();
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast("Password must be at least 8 characters", "error");
      return;
    }
    if (password !== confirm) {
      toast("Passwords don't match", "error");
      return;
    }
    setSavingPwd(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSavingPwd(false);
      toast(error.message, "error");
      return;
    }
    // Clear the must_change_password flag in case they were forced here.
    await supabase
      .from("staff")
      .update({ must_change_password: false })
      .eq("id", staff!.id);
    setSavingPwd(false);
    setPassword("");
    setConfirm("");
    toast("Password updated");
  }

  return (
    <div className="space-y-6">
      {/* Profile card */}
      <div className="surface-card p-5">
        <h2 className="text-base font-semibold tracking-tight">Profile</h2>
        <p className="mt-1 text-xs text-muted-foreground">Email and role can only be changed by an admin from the Staff page.</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</label>
            <p className="mt-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground font-mono">{staff.email}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">Role</label>
            <p className="mt-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">{ROLE_LABELS[staff.role] ?? staff.role}</p>
          </div>
        </div>

        <form onSubmit={saveProfile} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">Display name</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                className="mt-1.5 block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">Phone</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1.5 block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="04XX XXX XXX"
              />
            </div>
          </div>
          <div>
            <button
              type="submit"
              disabled={savingProfile}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {savingProfile ? "Saving..." : "Save profile"}
            </button>
          </div>
        </form>
      </div>

      {/* Password card */}
      <div className="surface-card p-5">
        <h2 className="text-base font-semibold tracking-tight">Change password</h2>
        <p className="mt-1 text-xs text-muted-foreground">Pick something at least 8 characters long.</p>

        <form onSubmit={savePassword} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                className="mt-1.5 block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">Confirm</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="mt-1.5 block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <button
              type="submit"
              disabled={savingPwd || !password}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {savingPwd ? "Updating..." : "Update password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
