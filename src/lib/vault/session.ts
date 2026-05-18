// Vault in-browser session. Holds the unlocked private key + folder keys in
// memory only. Per D4: never localStorage, re-lock on tab close/reload/15min
// idle/explicit lock.
//
// The store is intentionally NOT persisted. A page reload = vault re-locked.

"use client";

import { create } from "zustand";

interface VaultSession {
  unlockedAt: number | null;
  privateKey: CryptoKey | null;
  /** folder_id → unwrapped folder symmetric key */
  folderKeys: Map<string, CryptoKey>;
  /** public key (for sharing flow in Phase 2) */
  publicKey: CryptoKey | null;

  unlock: (params: { privateKey: CryptoKey; publicKey: CryptoKey }) => void;
  setFolderKey: (folderId: string, key: CryptoKey) => void;
  lock: () => void;
  isUnlocked: () => boolean;
}

export const useVaultSession = create<VaultSession>((set, get) => ({
  unlockedAt: null,
  privateKey: null,
  folderKeys: new Map(),
  publicKey: null,

  unlock: ({ privateKey, publicKey }) =>
    set({ privateKey, publicKey, unlockedAt: Date.now(), folderKeys: new Map() }),

  setFolderKey: (folderId, key) =>
    set((s) => {
      const next = new Map(s.folderKeys);
      next.set(folderId, key);
      return { folderKeys: next };
    }),

  lock: () =>
    set({ unlockedAt: null, privateKey: null, publicKey: null, folderKeys: new Map() }),

  isUnlocked: () => get().privateKey !== null,
}));
