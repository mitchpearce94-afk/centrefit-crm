"use client";

import { useState, useEffect } from "react";
import { useVaultSession } from "@/lib/vault/session";
import { useVaultIdleLock } from "@/lib/vault/use-vault-idle-lock";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import {
  setupVault,
  unlockVault,
  listFolders,
  listEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  decryptEntryRow,
  unwrapFolder,
  runCryptoSelfTest,
  createFolder,
  listOtherStaffPublicKeys,
  listFolderMembers,
  shareFolder,
  revokeMember,
  recoverVault,
  resetMasterPassword,
  listFolderLinks,
  linkFolderToRef,
  unlinkFolderFromRef,
  listPendingRotations,
  rotateFolderKey,
  type FolderRow,
  type EntryRow,
  type VaultStaffPublicKey,
  type FolderMember,
  type VaultRefType,
} from "@/lib/vault/api";
import type { VaultEntryPayload } from "@/lib/vault/crypto";
import { computeTotp, secondsRemainingInTotpStep } from "@/lib/vault/totp";

export function VaultShell({ isSetup }: { isSetup: boolean }) {
  const isUnlocked = useVaultSession((s) => s.isUnlocked());
  const [mode, setMode] = useState<"normal" | "recover">("normal");
  // Idle re-lock per D4 — 15 min, plus visibility-loss = lock. No-op while
  // already locked.
  useVaultIdleLock();
  if (!isSetup) return <SetupForm />;
  if (!isUnlocked) {
    return mode === "recover" ? (
      <RecoveryFlow onCancel={() => setMode("normal")} onDone={() => setMode("normal")} />
    ) : (
      <UnlockForm onForgot={() => setMode("recover")} />
    );
  }
  return <UnlockedVault />;
}

// ── Setup ───────────────────────────────────────────────────────────────

function SetupForm() {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [acked, setAcked] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) {
      toast("Master password must be at least 10 characters.", "error");
      return;
    }
    if (password !== confirm) {
      toast("Passwords don't match.", "error");
      return;
    }
    setBusy(true);
    try {
      const { recoveryCode } = await setupVault(password);
      setRecoveryCode(recoveryCode);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Setup failed", "error");
    }
    setBusy(false);
  }

  if (recoveryCode) {
    return (
      <div className="max-w-xl rounded-lg border border-amber-500/40 bg-amber-500/5 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-500">
          Save this recovery code somewhere safe
        </h2>
        <p className="mt-2 text-sm">
          If you forget your master password, this code is the only way to
          recover your vault. It will <span className="font-semibold">never be
          shown again</span>. Print it, paste it in a password manager
          outside Centrefit, or write it down somewhere physical and locked.
        </p>
        <div className="mt-4 rounded-md border border-border bg-card p-4 font-mono text-lg tracking-widest break-all">
          {recoveryCode}
        </div>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(recoveryCode).then(
              () => toast("Recovery code copied. Now save it somewhere safe."),
              () => toast("Copy failed. Select manually.", "error"),
            );
          }}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
        >
          Copy to clipboard
        </button>

        <label className="mt-5 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={acked}
            onChange={(e) => setAcked(e.target.checked)}
            className="mt-0.5 rounded border-border accent-primary"
          />
          <span>
            I have saved this recovery code somewhere outside Centrefit. I
            understand that losing both my master password AND this code
            means my vault data is unrecoverable.
          </span>
        </label>

        <button
          type="button"
          disabled={!acked}
          onClick={() => location.reload()}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          I've saved it — continue to vault
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="max-w-md space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Set your vault master password
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          This password is used to unlock the vault on this account. It is
          never sent to the server — only a one-way derivative is. There is
          no admin reset. If you forget it, only your recovery code can get
          you back in.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground">Master password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={10}
          className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="At least 10 characters"
          autoComplete="new-password"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground">Confirm</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          autoComplete="new-password"
        />
      </div>

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? "Setting up..." : "Set master password"}
      </button>
    </form>
  );
}

// ── Unlock ──────────────────────────────────────────────────────────────

function UnlockForm({ onForgot }: { onForgot: () => void }) {
  const unlock = useVaultSession((s) => s.unlock);
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    try {
      const { privateKey, publicKey } = await unlockVault(password);
      unlock({ privateKey, publicKey });
      setPassword("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Unlock failed", "error");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <LockIcon className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Unlock vault
        </h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Enter your master password. It stays in your browser — the server
        only receives a verifier.
      </p>
      <div>
        <label className="block text-xs font-medium text-muted-foreground">Master password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
          autoComplete="current-password"
          className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Unlocking..." : "Unlock"}
        </button>
        <button
          type="button"
          onClick={onForgot}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          Forgot master password?
        </button>
      </div>
    </form>
  );
}

function RecoveryFlow({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState<"enter-code" | "set-new-password">("enter-code");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryCodeRaw, setRecoveryCodeRaw] = useState<string | null>(null);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function verifyRecovery(e: React.FormEvent) {
    e.preventDefault();
    if (!recoveryInput.trim()) return;
    setBusy(true);
    try {
      const r = await recoverVault(recoveryInput);
      setRecoveryCodeRaw(r.recoveryCodeRaw);
      setPrivateKey(r.privateKey);
      setStep("set-new-password");
      toast("Recovery code accepted — now set a new master password.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Recovery failed", "error");
    }
    setBusy(false);
  }

  async function applyReset(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 10) {
      toast("New master password must be at least 10 characters.", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast("Passwords don't match.", "error");
      return;
    }
    if (!recoveryCodeRaw || !privateKey) {
      toast("Missing recovery state — start over.", "error");
      return;
    }
    setBusy(true);
    try {
      await resetMasterPassword({
        recoveryCodeRaw,
        newMasterPassword: newPassword,
        privateKey,
      });
      toast("Master password reset. Sign in below with the new one.");
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Reset failed", "error");
    }
    setBusy(false);
  }

  return (
    <div className="max-w-md space-y-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-500">
          Recover vault
        </h2>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Recovery uses the one-time code you printed at setup. After
        verification you&apos;ll be asked to set a new master password. The
        same recovery code keeps working — you don&apos;t need to save a new
        one.
      </p>

      {step === "enter-code" ? (
        <form onSubmit={verifyRecovery} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              Recovery code
            </label>
            <textarea
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value)}
              required
              autoFocus
              rows={3}
              placeholder="ABCD-EFGH-… (dashes/whitespace ok)"
              className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono tracking-widest focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Verifying..." : "Verify recovery code"}
          </button>
        </form>
      ) : (
        <form onSubmit={applyReset} className="space-y-3">
          <p className="rounded-md bg-card border border-border p-2 text-xs">
            ✓ Recovery code accepted. Set a new master password below.
          </p>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">New master password</label>
            <input
              type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              required minLength={10} autoFocus autoComplete="new-password"
              className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="At least 10 characters"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Confirm</label>
            <input
              type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              required autoComplete="new-password"
              className="mt-1 block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            type="submit" disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Resetting..." : "Set new master password"}
          </button>
        </form>
      )}
    </div>
  );
}

// ── Unlocked vault: folders + entries ───────────────────────────────────

function UnlockedVault() {
  const privateKey = useVaultSession((s) => s.privateKey);
  const publicKey = useVaultSession((s) => s.publicKey);
  const folderKeys = useVaultSession((s) => s.folderKeys);
  const setFolderKey = useVaultSession((s) => s.setFolderKey);
  const lock = useVaultSession((s) => s.lock);
  const { toast } = useToast();

  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderSettingsId, setFolderSettingsId] = useState<string | null>(null);

  async function refreshFolders() {
    const list = await listFolders();
    for (const f of list) {
      if (!folderKeys.has(f.id)) {
        const key = await unwrapFolder(f.wrapped_folder_key, privateKey!);
        setFolderKey(f.id, key);
      }
    }
    setFolders(list);
    return list;
  }

  // Load folders once, unwrap their keys with the private key, cache them.
  // Then check for any folders awaiting key rotation (member was removed
  // since the last unlock) and quietly perform the rotation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await refreshFolders();
        if (cancelled) return;
        if (list.length > 0) setSelectedFolderId(list[0].id);

        // Auto-rotate any pending. Runs after folders + keys are loaded
        // so the old key is in the session for re-encryption.
        const pending = await listPendingRotations();
        for (const p of pending) {
          const oldKey = useVaultSession.getState().folderKeys.get(p.folder_id);
          if (!oldKey) continue; // shouldn't happen — owner has the key
          try {
            const { newFolderKey } = await rotateFolderKey({ pending: p, oldFolderKey: oldKey });
            // Replace session-cached key with the new one.
            setFolderKey(p.folder_id, newFolderKey);
            toast(`Rotated folder key for "${p.folder_name}" — removed member can no longer decrypt new content.`);
          } catch (e) {
            toast(`Rotation failed for ${p.folder_name}: ${e instanceof Error ? e.message : "unknown"}`, "error");
          }
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to load folders", "error");
      }
      setLoadingFolders(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privateKey]);

  // Load entries when folder selection changes.
  useEffect(() => {
    if (!selectedFolderId) { setEntries([]); return; }
    (async () => {
      try {
        const rows = await listEntries(selectedFolderId);
        setEntries(rows);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to load entries", "error");
      }
    })();
  }, [selectedFolderId, toast]);

  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? null;
  const folderKey = selectedFolderId ? folderKeys.get(selectedFolderId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-2">
        <div className="flex items-center gap-2">
          <UnlockedIcon className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-primary">Vault unlocked</span>
        </div>
        <div className="flex items-center gap-2">
          <SelfTestButton />
          <button
            onClick={() => { lock(); toast("Vault locked."); }}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"
          >
            Lock vault
          </button>
        </div>
      </div>

      {loadingFolders ? (
        <p className="text-sm text-muted-foreground">Loading folders…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <aside className="space-y-1">
            <button
              onClick={() => setCreatingFolder(true)}
              className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              + New folder
            </button>
            {folders.map((f) => (
              <div key={f.id} className="flex items-center gap-1">
                <button
                  onClick={() => setSelectedFolderId(f.id)}
                  className={`flex flex-1 min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                    selectedFolderId === f.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  <FolderIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{f.name}</span>
                  {f.is_personal && (
                    <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase">
                      Personal
                    </span>
                  )}
                </button>
                {!f.is_personal && (
                  <button
                    onClick={() => setFolderSettingsId(folderSettingsId === f.id ? null : f.id)}
                    title="Folder members"
                    className={`shrink-0 rounded-md px-1.5 py-2 text-xs transition-colors ${
                      folderSettingsId === f.id
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <SettingsCogIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </aside>

          <section>
            {creatingFolder && publicKey && (
              <CreateFolderForm
                publicKey={publicKey}
                onCancel={() => setCreatingFolder(false)}
                onCreated={async (newId) => {
                  setCreatingFolder(false);
                  await refreshFolders();
                  setSelectedFolderId(newId);
                  toast("Folder created. You are the owner — share with teammates from the gear icon.");
                }}
              />
            )}

            {folderSettingsId && selectedFolder && folderKey && folderSettingsId === selectedFolderId ? (
              <FolderSettings
                folderId={folderSettingsId}
                folderName={folders.find((f) => f.id === folderSettingsId)?.name ?? ""}
                folderKey={folderKey}
                onClose={() => setFolderSettingsId(null)}
              />
            ) : folderSettingsId ? (
              <FolderSettingsLoader
                folderId={folderSettingsId}
                folderName={folders.find((f) => f.id === folderSettingsId)?.name ?? ""}
                onClose={() => setFolderSettingsId(null)}
                onNeedsSelect={() => setSelectedFolderId(folderSettingsId)}
              />
            ) : selectedFolder && folderKey ? (
              <FolderEntries
                folderId={selectedFolder.id}
                folderKey={folderKey}
                entries={entries}
                onChange={async () => {
                  const rows = await listEntries(selectedFolder.id);
                  setEntries(rows);
                }}
              />
            ) : folders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No folders yet. Setup should have created a Personal folder
                — try locking and unlocking, then come back.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Select a folder.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function CreateFolderForm({
  publicKey, onCancel, onCreated,
}: {
  publicKey: CryptoKey;
  onCancel: () => void;
  onCreated: (folderId: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await createFolder(name.trim(), publicKey);
      await onCreated(res.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Create folder failed", "error");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border border-primary/30 bg-card p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        New folder
      </div>
      <input
        value={name} onChange={(e) => setName(e.target.value)}
        autoFocus required
        placeholder="Folder name (e.g. Snap Fitness Warner)"
        className="block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm"
      />
      <p className="text-[11px] text-muted-foreground">
        Folder key is generated in your browser and wrapped with your public
        key. Add members from the gear icon once it&apos;s created.
      </p>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={busy}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {busy ? "Creating..." : "Create folder"}
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
          Cancel
        </button>
      </div>
    </form>
  );
}

// Wrapper that prompts the user to first select the folder so its key
// is unwrapped into the session before we render the settings panel.
function FolderSettingsLoader({
  folderId, folderName, onClose, onNeedsSelect,
}: {
  folderId: string; folderName: string; onClose: () => void; onNeedsSelect: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Folder members — {folderName}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Open the folder first to load its key into your session, then
            re-open these settings.
          </p>
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>
      <button
        onClick={onNeedsSelect}
        className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Open folder {folderName}
      </button>
    </div>
  );
}

function FolderSettings({
  folderId, folderName, folderKey, onClose,
}: {
  folderId: string;
  folderName: string;
  folderKey: CryptoKey;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [members, setMembers] = useState<FolderMember[]>([]);
  const [candidates, setCandidates] = useState<VaultStaffPublicKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<string>("");
  const [role, setRole] = useState<"viewer" | "editor" | "owner">("editor");
  const [busy, setBusy] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const [m, c] = await Promise.all([
        listFolderMembers(folderId),
        listOtherStaffPublicKeys(),
      ]);
      setMembers(m);
      setCandidates(c);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Load failed", "error");
    }
    setLoading(false);
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [folderId]);

  const existingMemberIds = new Set(members.map((m) => m.staff_id));
  const eligibleCandidates = candidates.filter(
    (c) => c.has_vault && c.public_key && !existingMemberIds.has(c.staff_id),
  );

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStaff) return;
    const cand = candidates.find((c) => c.staff_id === selectedStaff);
    if (!cand?.public_key) {
      toast("Recipient has no vault set up yet.", "error");
      return;
    }
    setBusy(true);
    try {
      await shareFolder({
        folderId,
        folderKey,
        recipientStaffId: cand.staff_id,
        recipientPublicKeyB64: cand.public_key,
        role,
      });
      toast(`${cand.display_name} added as ${role}.`);
      setAdding(false);
      setSelectedStaff("");
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Share failed", "error");
    }
    setBusy(false);
  }

  async function revoke(staffId: string, name: string) {
    if (!confirm(`Remove ${name} from this folder? They'll lose access immediately. Folder key rotation should follow (Phase 5).`)) return;
    try {
      await revokeMember(folderId, staffId);
      toast(`${name} removed.`);
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Revoke failed", "error");
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Folder members — {folderName}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Each member sees the folder key wrapped with their own public
            RSA key. The server never sees the unwrapped key.
          </p>
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading…</p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="divide-y divide-border rounded-md border border-border">
            {members.map((m) => (
              <div key={m.staff_id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                    {m.initials}
                  </span>
                  <span className="text-sm truncate">{m.display_name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{m.role}</span>
                </div>
                {m.role !== "owner" ? (
                  <button
                    onClick={() => revoke(m.staff_id, m.display_name)}
                    className="text-xs text-destructive hover:underline"
                  >
                    Remove
                  </button>
                ) : (
                  <span className="text-[10px] text-muted-foreground italic">owner</span>
                )}
              </div>
            ))}
          </div>

          <FolderLinksSection folderId={folderId} />

          {adding ? (
            <form onSubmit={addMember} className="space-y-2 rounded-md border border-primary/30 bg-muted/20 p-3">
              <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                <select
                  value={selectedStaff} onChange={(e) => setSelectedStaff(e.target.value)} required
                  className="rounded-md border border-border bg-input px-2.5 py-1.5 text-sm"
                >
                  <option value="">Pick teammate…</option>
                  {eligibleCandidates.map((c) => (
                    <option key={c.staff_id} value={c.staff_id}>{c.display_name}</option>
                  ))}
                </select>
                <select
                  value={role} onChange={(e) => setRole(e.target.value as typeof role)}
                  className="rounded-md border border-border bg-input px-2.5 py-1.5 text-sm"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="owner">Owner</option>
                </select>
                <button type="submit" disabled={busy || !selectedStaff}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {busy ? "Sharing..." : "Share"}
                </button>
              </div>
              {eligibleCandidates.length === 0 && (
                <p className="text-[11px] text-muted-foreground italic">
                  No eligible teammates — they either already have access
                  or haven&apos;t set up their vault yet.
                </p>
              )}
              <button type="button" onClick={() => setAdding(false)}
                className="text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </form>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
            >
              + Add member
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FolderEntries({
  folderId, folderKey, entries, onChange,
}: {
  folderId: string;
  folderKey: CryptoKey;
  entries: EntryRow[];
  onChange: () => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  // Decrypt all entries up-front so search can match across fields.
  // Small folders (<200 entries) — fine to do on load. Cached so flipping
  // entries open doesn't re-decrypt.
  const [decryptCache, setDecryptCache] = useState<Map<string, VaultEntryPayload>>(new Map());
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = new Map<string, VaultEntryPayload>();
      for (const row of entries) {
        try {
          next.set(row.id, await decryptEntryRow(folderKey, row));
        } catch {
          // Skip — corrupted or wrong-key entry. Surface only if all fail.
        }
      }
      if (!cancelled) setDecryptCache(next);
    })();
    return () => { cancelled = true; };
  }, [entries, folderKey]);

  const q = search.trim().toLowerCase();
  const filtered = q === "" ? entries : entries.filter((row) => {
    const p = decryptCache.get(row.id);
    if (!p) {
      // Fall back to server-stored title hint.
      return (row.title_hint ?? "").toLowerCase().includes(q);
    }
    return (
      p.title.toLowerCase().includes(q) ||
      (p.url ?? "").toLowerCase().includes(q) ||
      (p.username ?? "").toLowerCase().includes(q) ||
      (p.notes ?? "").toLowerCase().includes(q) ||
      (p.customFields ?? []).some((cf) =>
        cf.label.toLowerCase().includes(q) || cf.value.toLowerCase().includes(q),
      )
    );
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold shrink-0">
          {filtered.length} of {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </h3>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, URL, username, notes…"
          className="flex-1 max-w-md rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          + New entry
        </button>
      </div>

      {creating && (
        <EntryForm
          folderKey={folderKey}
          onCancel={() => setCreating(false)}
          onSave={async (payload, storeTitleHint) => {
            await createEntry(folderId, folderKey, payload, storeTitleHint);
            setCreating(false);
            await onChange();
            toast("Entry saved.");
          }}
        />
      )}

      <div className="divide-y divide-border rounded-md border border-border bg-card">
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {entries.length === 0
              ? "No entries yet. Click \"+ New entry\" to add one."
              : "No entries match your search."}
          </p>
        ) : filtered.map((row) => (
          <EntryRowView
            key={row.id}
            row={row}
            folderId={folderId}
            folderKey={folderKey}
            isOpen={openId === row.id}
            onToggle={() => setOpenId(openId === row.id ? null : row.id)}
            onChange={onChange}
            preDecrypted={decryptCache.get(row.id) ?? null}
          />
        ))}
      </div>
    </div>
  );
}

function EntryRowView({
  row, folderId, folderKey, isOpen, onToggle, onChange, preDecrypted,
}: {
  row: EntryRow;
  folderId: string;
  folderKey: CryptoKey;
  isOpen: boolean;
  onToggle: () => void;
  onChange: () => Promise<void>;
  preDecrypted: VaultEntryPayload | null;
}) {
  const { toast } = useToast();
  const [decrypted, setDecrypted] = useState<VaultEntryPayload | null>(preDecrypted);
  const [editing, setEditing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // If FolderEntries hands us the cached payload, use it; otherwise fall
  // back to lazy decrypt on open.
  useEffect(() => {
    if (preDecrypted) {
      setDecrypted(preDecrypted);
      return;
    }
    if (!isOpen || decrypted) return;
    decryptEntryRow(folderKey, row).then(setDecrypted, (e) => toast(`Decrypt failed: ${e.message}`, "error"));
  }, [isOpen, decrypted, folderKey, row, toast, preDecrypted]);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} copied. Clipboard clears in 30s.`);
      setTimeout(() => { navigator.clipboard.writeText("").catch(() => {}); }, 30_000);
    } catch {
      toast(`${label} copy failed`, "error");
    }
  }

  return (
    <div className="p-3">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-medium">
          {row.title_hint ?? (decrypted?.title ?? "Encrypted entry")}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {new Date(row.updated_at).toLocaleString("en-AU")}
        </span>
      </button>
      {isOpen && (
        <div className="mt-3 space-y-2 rounded-md bg-muted/30 p-3 text-sm">
          {!decrypted ? (
            <p className="text-xs text-muted-foreground italic">Decrypting…</p>
          ) : editing ? (
            <EntryForm
              folderKey={folderKey}
              initial={decrypted}
              onCancel={() => setEditing(false)}
              onSave={async (payload, storeTitleHint) => {
                await updateEntry(row.id, folderId, folderKey, payload, storeTitleHint);
                setEditing(false);
                setDecrypted(payload);
                await onChange();
              }}
            />
          ) : (
            <>
              <Field label="Title" value={decrypted.title} />
              {decrypted.url && (
                <Field label="URL" value={
                  <a href={decrypted.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {decrypted.url}
                  </a>
                } />
              )}
              {decrypted.username && (
                <Field label="Username" value={decrypted.username}
                  action={<button onClick={() => copy("Username", decrypted.username!)} className="text-xs text-primary">Copy</button>} />
              )}
              {decrypted.password && (
                <Field
                  label="Password"
                  value={
                    <span className="font-mono">{showPassword ? decrypted.password : "••••••••••"}</span>
                  }
                  action={
                    <div className="flex gap-2">
                      <button onClick={() => setShowPassword((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">
                        {showPassword ? "Hide" : "Show"}
                      </button>
                      <button onClick={() => copy("Password", decrypted.password!)} className="text-xs text-primary">Copy</button>
                    </div>
                  }
                />
              )}
              {decrypted.totpSecret && (
                <TotpField secret={decrypted.totpSecret} onCopy={(code) => copy("TOTP code", code)} />
              )}
              {decrypted.notes && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</div>
                  <pre className="whitespace-pre-wrap rounded bg-card border border-border px-2 py-1.5 text-xs">{decrypted.notes}</pre>
                </div>
              )}
              {decrypted.customFields?.map((cf, i) => (
                <Field key={i} label={cf.label} value={cf.value}
                  action={<button onClick={() => copy(cf.label, cf.value)} className="text-xs text-primary">Copy</button>} />
              ))}
              <div className="flex gap-2 pt-2 border-t border-border">
                <button onClick={() => setEditing(true)} className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent">Edit</button>
                <button
                  onClick={async () => {
                    if (!confirm("Delete this entry? This can't be undone.")) return;
                    try {
                      await deleteEntry(row.id, folderId);
                      toast("Entry deleted.");
                      await onChange();
                    } catch (e) {
                      toast(e instanceof Error ? e.message : "Delete failed", "error");
                    }
                  }}
                  className="rounded-md border border-destructive/40 text-destructive px-2.5 py-1 text-xs hover:bg-destructive/10"
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TotpField({ secret, onCopy }: { secret: string; onCopy: (code: string) => void }) {
  const [code, setCode] = useState<string>("------");
  const [remaining, setRemaining] = useState<number>(30);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const c = await computeTotp(secret);
        if (!cancelled) {
          setCode(c);
          setRemaining(secondsRemainingInTotpStep());
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "TOTP error");
      }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [secret]);

  if (err) {
    return (
      <div className="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
        TOTP: {err}
      </div>
    );
  }

  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          TOTP code · refreshes every 30s
        </div>
        <div className="font-mono text-xl tabular-nums tracking-widest">
          {code.slice(0, 3)} {code.slice(3)}
        </div>
        <div className="mt-1 h-1 w-32 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${(remaining / 30) * 100}%` }}
          />
        </div>
      </div>
      <button onClick={() => onCopy(code)} className="text-xs text-primary">Copy</button>
    </div>
  );
}

function Field({ label, value, action }: { label: string; value: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="break-all text-sm">{value}</div>
      </div>
      {action}
    </div>
  );
}

function EntryForm({
  folderKey: _folderKey, initial, onCancel, onSave,
}: {
  folderKey: CryptoKey;
  initial?: VaultEntryPayload;
  onCancel: () => void;
  onSave: (payload: VaultEntryPayload, storeTitleHint: boolean) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState(initial?.password ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [totpSecret, setTotpSecret] = useState(initial?.totpSecret ?? "");
  const [storeHint, setStoreHint] = useState(!!initial?.title);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onSave({
        title: title.trim(),
        url: url.trim() || undefined,
        username: username.trim() || undefined,
        password: password || undefined,
        notes: notes.trim() || undefined,
        totpSecret: totpSecret.trim() || undefined,
      }, storeHint);
    } catch (err) {
      // toast handled by caller
    } finally {
      setBusy(false);
    }
  }

  function generatePassword() {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
    setPassword(out);
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border border-primary/30 bg-card p-3">
      <input
        value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus
        placeholder="Title (e.g. Snap Fitness Warner router)"
        className="block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm"
      />
      <input
        value={url} onChange={(e) => setUrl(e.target.value)}
        placeholder="URL (optional)"
        className="block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm"
      />
      <input
        value={username} onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        className="block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm"
        autoComplete="off"
      />
      <div className="flex gap-1.5">
        <input
          value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          type="text"
          className="block flex-1 rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono"
          autoComplete="off"
        />
        <button type="button" onClick={generatePassword}
          className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
          Generate
        </button>
      </div>
      <input
        value={totpSecret} onChange={(e) => setTotpSecret(e.target.value)}
        placeholder="TOTP secret (base32 — optional)"
        className="block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono"
        autoComplete="off"
      />
      <textarea
        value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (multi-line OK)"
        rows={3}
        className="block w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm"
      />
      <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox" checked={storeHint} onChange={(e) => setStoreHint(e.target.checked)}
          className="mt-0.5 rounded border-border accent-primary"
        />
        <span>
          Store the first 32 chars of the title as a plaintext hint
          (server-readable). Helpful for the list view; default off for max
          privacy.
        </span>
      </label>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={busy}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {busy ? "Saving..." : initial ? "Update" : "Save"}
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
          Cancel
        </button>
      </div>
    </form>
  );
}

function FolderLinksSection({ folderId }: { folderId: string }) {
  const { toast } = useToast();
  const [links, setLinks] = useState<Array<{ ref_type: VaultRefType; ref_id: string; ref_label: string }>>([]);
  const [sites, setSites] = useState<Array<{ id: string; name: string; customer_name?: string }>>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);
  const [adding, setAdding] = useState(false);
  const [refType, setRefType] = useState<VaultRefType>("site");
  const [refId, setRefId] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      setLinks(await listFolderLinks(folderId));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Load links failed", "error");
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [folderId]);

  async function loadPickerData() {
    const supabase = createClient();
    const [s, c] = await Promise.all([
      supabase.from("customer_sites")
        .select("id, name, customer:customers!customer_id(name)")
        .order("name"),
      supabase.from("customers")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
    ]);
    setSites((s.data ?? []).map((r: any) => ({
      id: r.id, name: r.name,
      customer_name: Array.isArray(r.customer) ? r.customer[0]?.name : r.customer?.name,
    })));
    setCustomers((c.data ?? []) as { id: string; name: string }[]);
  }

  async function startAdding() {
    setAdding(true);
    if (sites.length === 0 && customers.length === 0) {
      await loadPickerData();
    }
  }

  async function submitLink(e: React.FormEvent) {
    e.preventDefault();
    if (!refId) return;
    // Already linked?
    if (links.some((l) => l.ref_type === refType && l.ref_id === refId)) {
      toast("Already linked to this record.", "error");
      return;
    }
    setBusy(true);
    try {
      await linkFolderToRef(folderId, refType, refId);
      toast(`Folder linked to this ${refType}.`);
      setAdding(false);
      setRefId("");
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Link failed", "error");
    }
    setBusy(false);
  }

  async function removeLink(refType: VaultRefType, refId: string, label: string) {
    if (!confirm(`Unlink folder from ${label}? Folder content + access stays the same — only the discoverability link is removed.`)) return;
    try {
      await unlinkFolderFromRef(folderId, refType, refId);
      toast("Link removed.");
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Unlink failed", "error");
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Linked to (sites / customers)
        </div>
        {!adding && (
          <button
            onClick={startAdding}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"
          >
            + Link record
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Surfaces this folder on the linked record&apos;s &quot;Vault&quot;
        tab. Linking doesn&apos;t grant access — folder membership still
        gates the actual content.
      </p>
      {links.length === 0 ? (
        <p className="text-[11px] italic text-muted-foreground">No links yet.</p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border bg-card">
          {links.map((l) => (
            <div key={`${l.ref_type}-${l.ref_id}`} className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{l.ref_type}</span>
                <span>{l.ref_label}</span>
              </div>
              <button
                onClick={() => removeLink(l.ref_type, l.ref_id, l.ref_label)}
                className="text-xs text-destructive hover:underline"
              >
                Unlink
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <form onSubmit={submitLink} className="space-y-2 rounded-md bg-muted/20 p-2">
          <div className="grid grid-cols-[auto_1fr_auto] gap-2">
            <select
              value={refType} onChange={(e) => { setRefType(e.target.value as VaultRefType); setRefId(""); }}
              className="rounded-md border border-border bg-input px-2.5 py-1.5 text-sm"
            >
              <option value="site">Site</option>
              <option value="customer">Customer</option>
            </select>
            <select
              value={refId} onChange={(e) => setRefId(e.target.value)} required
              className="rounded-md border border-border bg-input px-2.5 py-1.5 text-sm"
            >
              <option value="">Pick a {refType}…</option>
              {refType === "site"
                ? sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.customer_name ? ` — ${s.customer_name}` : ""}
                    </option>
                  ))
                : customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
            </select>
            <button type="submit" disabled={busy || !refId}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {busy ? "Linking..." : "Link"}
            </button>
          </div>
          <button type="button" onClick={() => setAdding(false)}
            className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}

function SelfTestButton() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        try {
          const { steps } = await runCryptoSelfTest();
          toast(`Crypto self-test passed (${steps.length} steps)`);
          // eslint-disable-next-line no-console
          console.log("[vault self-test]", steps);
        } catch (e) {
          toast(e instanceof Error ? e.message : "Self-test failed", "error");
        }
        setBusy(false);
      }}
      disabled={busy}
      className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
      title="Runs all crypto primitives in-memory without touching the server. See console for details."
    >
      {busy ? "Testing…" : "Crypto self-test"}
    </button>
  );
}

// ── Icons ───────────────────────────────────────────────────────────────

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function UnlockedIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}
function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}
function SettingsCogIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
