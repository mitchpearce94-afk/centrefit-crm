"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

/**
 * Passkey management (security session 2026-07-06). A registered passkey
 * makes sign-in a single Windows Hello / Face ID tap — no password, no
 * TOTP code (middleware treats a passkey ceremony as MFA-satisfied).
 * Registration and the WebAuthn ceremony are handled by supabase-js.
 */

interface PasskeyRow {
  id: string;
  friendly_name?: string | null;
  created_at: string;
  last_used_at?: string | null;
}

export function PasskeysSection() {
  const supabase = createClient();
  const { toast } = useToast();
  const [passkeys, setPasskeys] = useState<PasskeyRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function refresh() {
    const { data, error } = await supabase.auth.passkey.list();
    if (!error && data) setPasskeys(data as PasskeyRow[]);
    else setPasskeys([]);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addPasskey() {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.registerPasskey();
      if (error) throw new Error(error.message);
      toast(`Passkey added${data?.friendly_name ? ` (${data.friendly_name})` : ""} — next sign-in is one tap`);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't add passkey";
      toast(msg.toLowerCase().includes("cancel") ? "Passkey setup was cancelled" : msg, "error");
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id: string) {
    if (confirmingId !== id) {
      setConfirmingId(id);
      setTimeout(() => setConfirmingId(null), 4000);
      return;
    }
    setConfirmingId(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.passkey.delete({ passkeyId: id });
      if (error) throw new Error(error.message);
      toast("Passkey removed");
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't remove passkey", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Passkeys</h2>
          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
            Sign in with Face ID, Windows Hello or your password manager — one tap, no password,
            no authenticator code.
          </p>
        </div>
        <button
          type="button"
          onClick={addPasskey}
          disabled={busy}
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {busy ? "Working…" : "+ Add passkey"}
        </button>
      </div>

      <div className="mt-3">
        {passkeys === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : passkeys.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
            No passkeys yet — add one on this device to skip passwords and codes.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            {passkeys.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-xs font-medium">{p.friendly_name || "Passkey"}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    added {new Date(p.created_at).toLocaleDateString("en-AU")}
                    {p.last_used_at ? ` · last used ${new Date(p.last_used_at).toLocaleDateString("en-AU")}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removePasskey(p.id)}
                  disabled={busy}
                  className={`shrink-0 rounded-md px-2 py-1 text-[11px] transition-colors ${
                    confirmingId === p.id
                      ? "bg-destructive text-white font-semibold"
                      : "border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40"
                  }`}
                >
                  {confirmingId === p.id ? "Confirm" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
