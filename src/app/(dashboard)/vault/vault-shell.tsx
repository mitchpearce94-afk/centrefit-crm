"use client";

import { useState, useEffect } from "react";
import { useVaultSession } from "@/lib/vault/session";
import { useVaultIdleLock } from "@/lib/vault/use-vault-idle-lock";
import { useToast } from "@/components/ui/toast";
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
  type FolderRow,
  type EntryRow,
} from "@/lib/vault/api";
import type { VaultEntryPayload } from "@/lib/vault/crypto";

export function VaultShell({ isSetup }: { isSetup: boolean }) {
  const isUnlocked = useVaultSession((s) => s.isUnlocked());
  // Idle re-lock per D4 — 15 min, plus visibility-loss = lock. No-op while
  // already locked.
  useVaultIdleLock();
  if (!isSetup) return <SetupForm />;
  if (!isUnlocked) return <UnlockForm />;
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

function UnlockForm() {
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
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? "Unlocking..." : "Unlock"}
      </button>
    </form>
  );
}

// ── Unlocked vault: folders + entries ───────────────────────────────────

function UnlockedVault() {
  const privateKey = useVaultSession((s) => s.privateKey);
  const folderKeys = useVaultSession((s) => s.folderKeys);
  const setFolderKey = useVaultSession((s) => s.setFolderKey);
  const lock = useVaultSession((s) => s.lock);
  const { toast } = useToast();

  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(true);

  // Load folders once, unwrap their keys with the private key, cache them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listFolders();
        for (const f of list) {
          if (!folderKeys.has(f.id)) {
            const key = await unwrapFolder(f.wrapped_folder_key, privateKey!);
            setFolderKey(f.id, key);
          }
        }
        if (cancelled) return;
        setFolders(list);
        if (list.length > 0) setSelectedFolderId(list[0].id);
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
      ) : folders.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No folders yet. Setup should have created a Personal folder — try
          locking and unlocking, then come back.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
          <aside className="space-y-1">
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedFolderId(f.id)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  selectedFolderId === f.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`}
              >
                <FolderIcon className="h-4 w-4" />
                <span className="truncate">{f.name}</span>
                {f.is_personal && (
                  <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase">
                    Personal
                  </span>
                )}
              </button>
            ))}
          </aside>

          <section>
            {selectedFolder && folderKey ? (
              <FolderEntries
                folderId={selectedFolder.id}
                folderKey={folderKey}
                entries={entries}
                onChange={async () => {
                  const rows = await listEntries(selectedFolder.id);
                  setEntries(rows);
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select a folder.</p>
            )}
          </section>
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{entries.length} {entries.length === 1 ? "entry" : "entries"}</h3>
        <button
          onClick={() => setCreating(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
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
          }}
        />
      )}

      <div className="divide-y divide-border rounded-md border border-border bg-card">
        {entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No entries yet. Click "+ New entry" to add one.
          </p>
        ) : entries.map((row) => (
          <EntryRowView
            key={row.id}
            row={row}
            folderId={folderId}
            folderKey={folderKey}
            isOpen={openId === row.id}
            onToggle={() => setOpenId(openId === row.id ? null : row.id)}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  );
}

function EntryRowView({
  row, folderId, folderKey, isOpen, onToggle, onChange,
}: {
  row: EntryRow;
  folderId: string;
  folderKey: CryptoKey;
  isOpen: boolean;
  onToggle: () => void;
  onChange: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [decrypted, setDecrypted] = useState<VaultEntryPayload | null>(null);
  const [editing, setEditing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!isOpen || decrypted) return;
    decryptEntryRow(folderKey, row).then(setDecrypted, (e) => toast(`Decrypt failed: ${e.message}`, "error"));
  }, [isOpen, decrypted, folderKey, row, toast]);

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
