"use client";

import Link from "next/link";

export interface VaultFolderForRefRow {
  folder_id: string;
  folder_name: string;
  is_personal: boolean;
  has_access: boolean;
  entry_count: number;
}

/**
 * Site detail "Vault" tab. Read-only listing of folders linked to this
 * site. Doesn't decrypt anything — that happens on /vault where the
 * unlocked session lives. We just surface "X folders associated, here
 * are the names, you have access to N of them."
 *
 * Linking a folder TO a site is done from the folder settings panel
 * inside /vault (the owner picks the site there).
 */
export function SiteVaultPanel({
  siteId,
  initialFolders,
}: {
  siteId: string;
  initialFolders: VaultFolderForRefRow[];
}) {
  if (initialFolders.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
        No vault folders linked to this site yet.
        <div className="mt-2 text-xs">
          Folder owners can link folders to this site from the
          {" "}<Link href="/vault" className="text-primary hover:underline">vault</Link>{" "}
          folder settings panel.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Vault folders associated with this site. Membership is set per
        folder in the vault — the count below reflects what you can see.
      </p>
      <div className="divide-y divide-border rounded-md border border-border bg-card">
        {initialFolders.map((f) => (
          <div key={f.folder_id} className="flex items-center justify-between px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium">{f.folder_name}</div>
              <div className="text-[11px] text-muted-foreground">
                {f.has_access
                  ? `${f.entry_count} ${f.entry_count === 1 ? "entry" : "entries"} you can see`
                  : "No access — ask an owner to share"}
              </div>
            </div>
            {f.has_access ? (
              <Link
                href="/vault"
                className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"
              >
                Open in vault →
              </Link>
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                Locked
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
