// Vault client API. All encryption happens here on the browser; the server
// only receives ciphertext + wrapped keys.

"use client";

import { createClient } from "@/lib/supabase/client";
import {
  deriveKeysFromMasterPassword,
  newPbkdf2Salt,
  generateRsaKeypair,
  exportPublicKeyB64,
  importPublicKeyB64,
  wrapPrivateKeyWithMasterKey,
  unwrapPrivateKeyWithMasterKey,
  generateFolderKey,
  wrapFolderKeyForPublicKey,
  unwrapFolderKey,
  encryptEntry,
  decryptEntry,
  generateRecoveryCode,
  type VaultEntryPayload,
} from "./crypto";

export interface SetupResult {
  personalFolderId: string;
  recoveryCode: string;
}

/**
 * First-time vault setup. Generates a keypair, derives keys from the master
 * password, wraps the private key with the master-derived key AND with a
 * recovery-code-derived key, generates a Personal folder symmetric key,
 * wraps it with the user's public key, and hands the bundle to setup_vault
 * RPC.
 *
 * Returns the recovery code — MUST be displayed once and never persisted.
 */
export async function setupVault(masterPassword: string): Promise<SetupResult> {
  if (masterPassword.length < 10) {
    throw new Error("Master password must be at least 10 characters.");
  }
  const supabase = createClient();

  // 1. Derive auth + encryption keys from master password.
  const encSaltB64 = newPbkdf2Salt();
  const { authKeyB64, encryptionKey: masterEncKey } = await deriveKeysFromMasterPassword(
    masterPassword, encSaltB64,
  );

  // 2. Generate the RSA keypair.
  const { publicKey, privateKey } = await generateRsaKeypair();
  const publicKeyB64 = await exportPublicKeyB64(publicKey);

  // 3. Wrap the private key with the master encryption key.
  const wrappedPk = await wrapPrivateKeyWithMasterKey(privateKey, masterEncKey);

  // 4. Generate recovery code, derive a recovery key, wrap private key again.
  const recoveryCode = generateRecoveryCode();
  const recoverySaltB64 = newPbkdf2Salt();
  const { encryptionKey: recoveryEncKey } = await deriveKeysFromMasterPassword(
    recoveryCode, recoverySaltB64,
  );
  const recoveryWrappedPk = await wrapPrivateKeyWithMasterKey(privateKey, recoveryEncKey);

  // 5. Create the Personal folder symmetric key + wrap with user's public key.
  const personalFolderKey = await generateFolderKey();
  const wrappedFolderKeyB64 = await wrapFolderKeyForPublicKey(personalFolderKey, publicKey);

  // 6. Call setup_vault RPC.
  const { data, error } = await supabase.rpc("setup_vault", {
    p_auth_key: authKeyB64,
    p_enc_salt: encSaltB64,
    p_public_key: publicKeyB64,
    p_wrapped_private_key: wrappedPk.ciphertextB64,
    p_wrapped_pk_iv: wrappedPk.ivB64,
    p_recovery_wrapped_pk: recoveryWrappedPk.ciphertextB64,
    p_recovery_wrapped_iv: recoveryWrappedPk.ivB64,
    p_recovery_salt: recoverySaltB64,
    p_personal_folder_name: "Personal",
    p_wrapped_folder_key: wrappedFolderKeyB64,
  });
  if (error) throw new Error(`setup_vault failed: ${error.message}`);

  return { personalFolderId: data as string, recoveryCode };
}

export interface UnlockResult {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

/**
 * Unlock the vault. Derives the auth_key locally, sends it to unlock_vault
 * which returns the wrapped private key. Client unwraps with the
 * master-derived encryption key. Returns the unlocked CryptoKey objects —
 * the caller should hand them straight to useVaultSession.unlock().
 */
export async function unlockVault(masterPassword: string): Promise<UnlockResult> {
  const supabase = createClient();

  // Step 1: fetch the salt so we can derive auth_key + encryption_key with
  // the same params used at setup.
  const { data: salt, error: saltErr } = await supabase
    .from("vault_users")
    .select("enc_salt")
    .single();
  if (saltErr) throw new Error(`vault_users lookup: ${saltErr.message}`);
  if (!salt?.enc_salt) throw new Error("Vault not set up for this account.");

  const { authKeyB64, encryptionKey: masterEncKey } = await deriveKeysFromMasterPassword(
    masterPassword, salt.enc_salt as string,
  );

  // Step 2: verify via RPC.
  const { data, error } = await supabase.rpc("unlock_vault", { p_auth_key: authKeyB64 });
  if (error) throw new Error(`unlock_vault failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) throw new Error("Incorrect master password.");

  // Step 3: unwrap the private key.
  const privateKey = await unwrapPrivateKeyWithMasterKey(
    row.wrapped_private_key as string,
    row.wrapped_pk_iv as string,
    masterEncKey,
  );
  const publicKey = await importPublicKeyB64(row.public_key as string);

  return { privateKey, publicKey };
}

// ── Folders & entries (single-user Phase 1) ─────────────────────────────

export interface FolderRow {
  id: string;
  name: string;
  is_personal: boolean;
  wrapped_folder_key: string;
}

/** List folders this staff has access to (incl. the wrapped folder key). */
export async function listFolders(): Promise<FolderRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vault_folder_members")
    .select("wrapped_folder_key, folder:vault_folders(id, name, is_personal)")
    .eq("staff_id", (await supabase.auth.getUser()).data.user!.id);
  if (error) throw new Error(`listFolders: ${error.message}`);
  return (data ?? []).flatMap((row) => {
    // The Supabase typed join may surface `folder` as object|array depending
    // on FK shape; normalise to object.
    const f = Array.isArray(row.folder) ? row.folder[0] : row.folder;
    if (!f) return [];
    return [{
      id: f.id as string,
      name: f.name as string,
      is_personal: f.is_personal as boolean,
      wrapped_folder_key: row.wrapped_folder_key as string,
    }];
  });
}

export interface EntryRow {
  id: string;
  folder_id: string;
  ciphertext: string;
  iv: string;
  title_hint: string | null;
  updated_at: string;
}

export async function listEntries(folderId: string): Promise<EntryRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("vault_entries")
    .select("id, folder_id, ciphertext, iv, title_hint, updated_at")
    .eq("folder_id", folderId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listEntries: ${error.message}`);
  return (data ?? []) as EntryRow[];
}

export async function createEntry(
  folderId: string,
  folderKey: CryptoKey,
  payload: VaultEntryPayload,
  storeTitleHint = false,
): Promise<EntryRow> {
  const supabase = createClient();
  const { ciphertextB64, ivB64 } = await encryptEntry(folderKey, payload);
  const { data, error } = await supabase
    .from("vault_entries")
    .insert({
      folder_id: folderId,
      ciphertext: ciphertextB64,
      iv: ivB64,
      title_hint: storeTitleHint ? payload.title.slice(0, 32) : null,
    })
    .select("id, folder_id, ciphertext, iv, title_hint, updated_at")
    .single();
  if (error) throw new Error(`createEntry: ${error.message}`);
  await supabase.rpc("vault_log_event", {
    p_action: "create_entry", p_folder_id: folderId, p_entry_id: data.id, p_metadata: null,
  });
  return data as EntryRow;
}

export async function updateEntry(
  entryId: string,
  folderId: string,
  folderKey: CryptoKey,
  payload: VaultEntryPayload,
  storeTitleHint = false,
): Promise<EntryRow> {
  const supabase = createClient();
  const { ciphertextB64, ivB64 } = await encryptEntry(folderKey, payload);
  const { data, error } = await supabase
    .from("vault_entries")
    .update({
      ciphertext: ciphertextB64,
      iv: ivB64,
      title_hint: storeTitleHint ? payload.title.slice(0, 32) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", entryId)
    .select("id, folder_id, ciphertext, iv, title_hint, updated_at")
    .single();
  if (error) throw new Error(`updateEntry: ${error.message}`);
  await supabase.rpc("vault_log_event", {
    p_action: "edit_entry", p_folder_id: folderId, p_entry_id: entryId, p_metadata: null,
  });
  return data as EntryRow;
}

export async function deleteEntry(entryId: string, folderId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("vault_entries").delete().eq("id", entryId);
  if (error) throw new Error(`deleteEntry: ${error.message}`);
  await supabase.rpc("vault_log_event", {
    p_action: "delete_entry", p_folder_id: folderId, p_entry_id: entryId, p_metadata: null,
  });
}

/** Decrypt an entry payload using the cached folder key. */
export async function decryptEntryRow(folderKey: CryptoKey, row: EntryRow): Promise<VaultEntryPayload> {
  return decryptEntry(folderKey, row.ciphertext, row.iv);
}

/** Take the wrapped folder key from listFolders + the user's private key,
 * unwrap, and return the symmetric folder key for use in encryptEntry. */
export async function unwrapFolder(
  wrappedB64: string, privateKey: CryptoKey,
): Promise<CryptoKey> {
  return unwrapFolderKey(wrappedB64, privateKey);
}

// ── Phase 2: folder creation + sharing ──────────────────────────────────

/**
 * Create a new shared (non-personal) folder. The creator becomes its owner
 * with their wrapped folder key. Done in two writes (folder insert →
 * member insert) — RLS allows both because the existing policies trust
 * created_by = auth.uid() for folders and the owner-or-self check for
 * members.
 */
export async function createFolder(
  name: string,
  publicKey: CryptoKey,
): Promise<{ id: string; folderKey: CryptoKey; wrappedFolderKeyB64: string }> {
  const supabase = createClient();
  const folderKey = await generateFolderKey();
  const wrappedFolderKeyB64 = await wrapFolderKeyForPublicKey(folderKey, publicKey);

  const { data: folder, error } = await supabase
    .from("vault_folders")
    .insert({ name, is_personal: false, created_by: (await supabase.auth.getUser()).data.user!.id })
    .select("id")
    .single();
  if (error) throw new Error(`createFolder: ${error.message}`);

  const { error: memErr } = await supabase
    .from("vault_folder_members")
    .insert({
      folder_id: folder.id,
      staff_id: (await supabase.auth.getUser()).data.user!.id,
      role: "owner",
      wrapped_folder_key: wrappedFolderKeyB64,
    });
  if (memErr) throw new Error(`createFolder member: ${memErr.message}`);

  await supabase.rpc("vault_log_event", {
    p_action: "create_folder", p_folder_id: folder.id, p_entry_id: null, p_metadata: { name },
  });

  return { id: folder.id as string, folderKey, wrappedFolderKeyB64 };
}

export interface VaultStaffPublicKey {
  staff_id: string;
  display_name: string;
  initials: string;
  public_key: string | null;
  has_vault: boolean;
}

/** List other staff with their public key (null if they haven't set up vault yet). */
export async function listOtherStaffPublicKeys(): Promise<VaultStaffPublicKey[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("vault_list_public_keys");
  if (error) throw new Error(`listOtherStaffPublicKeys: ${error.message}`);
  return (data ?? []) as VaultStaffPublicKey[];
}

export interface FolderMember {
  staff_id: string;
  display_name: string;
  initials: string;
  role: "viewer" | "editor" | "owner";
  added_at: string;
}

export async function listFolderMembers(folderId: string): Promise<FolderMember[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("vault_list_folder_members", { p_folder_id: folderId });
  if (error) throw new Error(`listFolderMembers: ${error.message}`);
  return (data ?? []) as FolderMember[];
}

/**
 * Share a folder with another staff member. Caller MUST already have the
 * unwrapped folder key (passed in — usually pulled from the
 * useVaultSession.folderKeys cache).
 */
export async function shareFolder(params: {
  folderId: string;
  folderKey: CryptoKey;
  recipientStaffId: string;
  recipientPublicKeyB64: string;
  role: "viewer" | "editor" | "owner";
}): Promise<void> {
  const supabase = createClient();
  const recipientPub = await importPublicKeyB64(params.recipientPublicKeyB64);
  const wrapped = await wrapFolderKeyForPublicKey(params.folderKey, recipientPub);

  const { error } = await supabase.rpc("vault_share_folder", {
    p_folder_id: params.folderId,
    p_recipient_staff_id: params.recipientStaffId,
    p_role: params.role,
    p_wrapped_folder_key: wrapped,
  });
  if (error) throw new Error(`shareFolder: ${error.message}`);
}

export async function revokeMember(folderId: string, staffId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("vault_revoke_member", {
    p_folder_id: folderId, p_staff_id: staffId,
  });
  if (error) throw new Error(`revokeMember: ${error.message}`);
}

/**
 * Self-test: runs a full crypto round-trip (setup → unlock → encrypt entry
 * → decrypt entry) in memory only, without touching the database. Useful as
 * a sanity check before trusting prod data to the system. Throws on failure.
 */
export async function runCryptoSelfTest(): Promise<{ steps: string[] }> {
  const steps: string[] = [];
  const masterPassword = "TestMasterPass#" + Math.random().toString(36).slice(2);

  // 1. derive
  const salt = newPbkdf2Salt();
  const { authKeyB64, encryptionKey: encKey } = await deriveKeysFromMasterPassword(masterPassword, salt);
  if (!authKeyB64) throw new Error("PBKDF2: empty auth key");
  steps.push("PBKDF2 derivation OK (auth + enc keys produced)");

  // 2. RSA keypair + wrap private key + unwrap
  const { publicKey, privateKey } = await generateRsaKeypair();
  const pubB64 = await exportPublicKeyB64(publicKey);
  if (pubB64.length < 100) throw new Error("RSA public key export too short");
  const wrapped = await wrapPrivateKeyWithMasterKey(privateKey, encKey);
  const restored = await unwrapPrivateKeyWithMasterKey(wrapped.ciphertextB64, wrapped.ivB64, encKey);
  if (!restored) throw new Error("RSA private key unwrap failed");
  steps.push("RSA-4096 keypair generation + private-key wrap/unwrap OK");

  // 3. Folder key wrap with public key, unwrap with private key
  const folderKey = await generateFolderKey();
  const wrappedFolder = await wrapFolderKeyForPublicKey(folderKey, publicKey);
  const unwrappedFolder = await unwrapFolderKey(wrappedFolder, restored);
  steps.push("Folder key wrap (RSA-OAEP) + unwrap OK");

  // 4. Entry encrypt + decrypt round trip
  const payload: VaultEntryPayload = {
    title: "Self-test entry",
    url: "https://example.com",
    username: "tester",
    password: "Hunter2!Sentinel#456",
    notes: "Multi-line\nnotes\nhere.",
    customFields: [{ label: "API Key", value: "sk_test_abc123" }],
  };
  const enc = await encryptEntry(unwrappedFolder, payload);
  const dec = await decryptEntry(unwrappedFolder, enc.ciphertextB64, enc.ivB64);
  if (JSON.stringify(dec) !== JSON.stringify(payload)) {
    throw new Error("Entry round-trip mismatch — encrypted payload didn't decrypt to original");
  }
  steps.push("Entry encrypt + decrypt round-trip OK (payload preserved exactly)");

  // 5. Tamper test: flip a byte in the ciphertext, expect decrypt to throw.
  const tampered = enc.ciphertextB64.slice(0, -2) + (enc.ciphertextB64.endsWith("=") ? "Aa" : "==");
  let threw = false;
  try {
    await decryptEntry(unwrappedFolder, tampered, enc.ivB64);
  } catch { threw = true; }
  if (!threw) throw new Error("AES-GCM tamper detection failed — decrypt should have thrown");
  steps.push("AES-GCM tamper detection OK (corrupted ciphertext rejected)");

  return { steps };
}
