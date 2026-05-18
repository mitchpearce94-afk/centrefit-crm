# Centrefit CRM Vault — CONTEXT

Locked design decisions for the in-CRM password manager. Every task in the
build plan must reference one of these decisions (per the GSD principle:
CONTEXT.md before planning, no silent scope reduction during implementation).

Last updated: 2026-05-18. Owner: Mitchell.

---

## Goal

A team password manager **built into the CRM** at `crm.centrefit.com.au/vault`
that lets Centrefit staff store and share credentials (site logins, customer
NBN admin accounts, Xero, GoCardless, internal tools) without ever sending
plaintext passwords to the server. Folder-based ACL so staff only see what's
relevant to their role. UX modelled on 1Password Teams.

Replaces: ad-hoc password sharing via Slack/email/sticky notes.
Does **not** replace: customer-facing self-service portals (those are out of
scope for v1).

---

## Architectural decisions

### D1. Crypto model: true zero-knowledge with per-folder key wrapping
- Each staff member generates an **asymmetric keypair** (RSA-OAEP 4096 or
  Curve25519) in their browser on first vault setup. Public key uploaded
  to server, private key encrypted at rest with their master password.
- Each folder has a **random symmetric key** (AES-256-GCM).
- Entries are encrypted with their folder's symmetric key, client-side,
  before upload. Server stores opaque ciphertext.
- Sharing: when an admin grants Staff B access to a folder, an existing
  member (Staff A) downloads B's public key, wraps the folder key with it,
  uploads the wrapped key. B's browser unwraps with B's private key.
- The Supabase server **never sees plaintext passwords, folder keys, or
  master passwords.** A full DB dump leaks ciphertext + bcrypt hashes.

### D2. Key derivation
- PBKDF2-SHA256, 600,000 iterations (OWASP 2023 recommendation). Match
  Mark's vault.
- Two keys derived from the master password: an **auth key** (sent to
  server, bcrypted at cost 12, stored) and an **encryption key** (kept in
  browser, used to wrap the user's private key).

### D3. Recovery model: one-time recovery code at signup
- On first vault setup, generate a random recovery code (display once,
  user prints it). The recovery code is itself derived from a high-entropy
  random value; we store an encryption of the user's private key wrapped
  with a key derived from the recovery code.
- If the user forgets their master password: they enter the recovery code
  to regain access to their private key, then set a new master password.
- If they lose **both** master password and recovery code: their account is
  rebuilt empty; folder owners must re-share each folder. (Acceptable.)
- No "admin can reset and recover the vault" — that would break zero-knowledge.

### D4. Vault session: separate from CRM session
- CRM login (Supabase auth) gets you to the CRM. The vault is locked
  separately and requires the master password to unlock.
- Unlock state stored in browser memory only (NOT localStorage). Vault
  re-locks on:
  - Tab close / page reload.
  - 15 min idle (vault is stricter than CRM).
  - Explicit "lock vault" button.
- After lock, viewing any entry requires re-entering the master password.

### D5. Folder model
- Folders are **flat** in v1 (no nesting). Re-evaluate after 100+ entries.
- Folder ACL is per-staff: `vault_folder_members(folder_id, staff_id, role)`.
- Roles: `viewer` (read), `editor` (read/write), `owner` (read/write + can
  add/remove members). Multiple owners per folder (avoids lockout if one
  owner leaves).
- One special folder per staff: "Personal" — auto-created, only the staff
  member is a member, never shareable.
- Removing a staff from a folder requires the folder key to be rotated
  (D11). The CRM admin who removes them schedules the rotation, which is
  performed by any remaining folder owner the next time they unlock.

### D6. Session security (Phase 0 — shipped 2026-05-18)
- CRM session: 30 min idle timeout (sliding window), 12 hr hard cap.
  Enforced in middleware via `cf-last-activity` + `cf-session-started`
  cookies (httpOnly, secure, SameSite=Lax) and by a client-side
  `<IdleLogout />` component in the dashboard layout.
- After timeout, redirect to `/login?reason=idle` or `?reason=expired`.
- Cookies cleared on timeout and on explicit signout.

### D7. Sensitive-route re-auth (Phase 0 → Phase 1)
- Vault unlock is the main consumer of this in v1. Future use: payroll,
  customer financial details. Infrastructure built generically: a
  `requireFreshAuth({ withinSeconds })` server helper + a `<ReAuthGate />`
  client component that shows a password prompt before rendering children.

### D8. Data model (Supabase)

```
vault_users
  staff_id (PK, FK staff.id)
  auth_key_hash       text      bcrypt of PBKDF2-derived auth key
  enc_salt            text      base64 salt for PBKDF2
  wrapped_private_key text      private key encrypted with master-derived key
  recovery_wrapped_pk text      private key encrypted with recovery-code key
  public_key          text      base64 SPKI public key
  created_at          timestamptz
  vault_setup_at      timestamptz
  last_unlock_at      timestamptz

vault_folders
  id                  uuid PK
  name                text
  description         text NULL
  is_personal         boolean   true for the auto-created per-user folder
  created_by          uuid FK staff.id
  created_at          timestamptz

vault_folder_members
  folder_id           uuid FK vault_folders.id
  staff_id            uuid FK staff.id
  role                text      'viewer' | 'editor' | 'owner'
  wrapped_folder_key  text      folder key encrypted with this staff's public key
  added_by            uuid FK staff.id
  added_at            timestamptz
  PRIMARY KEY (folder_id, staff_id)

vault_entries
  id                  uuid PK
  folder_id           uuid FK vault_folders.id
  ciphertext          text      AES-256-GCM encrypted JSON {title,url,username,password,notes,totp_secret,custom_fields}
  iv                  text      base64 12-byte IV
  /* server-readable metadata for sort/search without decryption — kept minimal */
  title_hint          text      first 32 chars of title in plaintext for the list view; staff opt-in only
  updated_at          timestamptz
  created_by          uuid FK staff.id

vault_audit_log
  id                  uuid PK
  staff_id            uuid FK staff.id
  action              text      'unlock' | 'view_entry' | 'create_entry' | 'edit_entry' | 'delete_entry' | 'share_folder' | 'revoke_member' | 'rotate_folder_key'
  folder_id           uuid NULL
  entry_id            uuid NULL
  metadata            jsonb
  created_at          timestamptz
```

- All tables RLS-locked. `vault_entries` row access requires the requesting
  staff_id to be in `vault_folder_members` for the entry's folder.
- `vault_audit_log` is append-only via a Postgres function with
  `security definer`; the table itself denies UPDATE/DELETE for all.

### D9. Title hint (D8 caveat)
- Storing a server-readable plaintext title hint trades a bit of privacy
  for usability (list view without decrypting every entry). Default OFF —
  user can choose per-entry whether to opt in. If off, the list shows
  "Encrypted entry" until decrypted on hover/click.

### D10. CRM integration
- `Sites` detail page gets a "Site passwords" tab if the site is linked to
  a vault folder. Showing folder name + count of entries; click goes to
  vault filtered to that folder.
- `Customers` detail page: same pattern.
- Linking is manual in v1 (staff associates a folder with a site or
  customer). Automatic creation of a folder when a new customer is created
  is a Phase 5 nice-to-have.

### D11. Key rotation on staff offboarding
- When a staff member is deactivated, any folder they had access to is
  flagged for rotation.
- Next folder owner unlock generates a new folder key, re-encrypts every
  entry under the new key, distributes wrapped copies to remaining members,
  archives the old key (so historic ciphertext can still be decrypted if
  needed for audit).
- Old wrapped key for the offboarded staff is hard-deleted.

### D12. Audit log retention
- Indefinite. Audit log is intentionally not RLS-restricted by folder —
  admins can see all access events. Staff can see only their own.

### D13. UX shape (1Password Teams reference)
- Two-pane layout: left = sidebar with folders + search, right = entry
  list / entry detail.
- Top: master-password unlock state indicator (locked padlock / unlocked
  open lock with countdown to next idle re-lock).
- Entry detail: title, URL (click = open in new tab), username (click =
  copy), password (click reveal, click copy, clipboard auto-clears after
  30 seconds), notes (markdown rendered), TOTP (live-rotating 6-digit
  code if a secret is stored), custom fields.
- Generate password: configurable length, symbol toggle.
- Add entry: form with all the above fields, folder picker.
- Folder management screen (owners only): members + role, "rotate key now"
  button.

### D14. What we are explicitly NOT building in v1
- File attachments inside entries. Add in v2 if needed.
- Browser extension. Use the web app.
- Mobile native app. The CRM is mobile-responsive; vault inherits that.
- SSO / SAML for entries (1Password's "fill from vault" extension).
  Manual copy-paste only in v1.
- Sharing entries to non-staff (external clients). Out of scope.

---

## Phased build

| Phase | Scope | Estimate | Status |
|------:|-------|----------|--------|
| **0** | Session security: 30min idle, 12hr max, login banners, IdleLogout component | 1 day | **DONE 2026-05-18** |
| **1** | Vault foundation: schema, Supabase migration, master-password setup ceremony, keypair generation, single-user encrypted entries, Personal folder auto-create | 3–4 days | Not started |
| **2** | Folder model + sharing: per-folder symmetric keys, key wrapping on member add, ACL enforcement in RLS | 3–4 days | Not started |
| **3** | UX polish: 1Password-style sidebar, search, copy buttons + clipboard auto-clear, idle re-lock, generate-password, TOTP support | 3–4 days | Not started |
| **4** | CRM integration: link folders to sites/customers, "Site passwords" tab on site detail | 1–2 days | Not started |
| **5** | Hardening: audit log writes, recovery flow end-to-end test, key rotation on staff offboarding, optional MFA on vault unlock | 2–3 days | Not started |

Total: ~3 weeks of focused work.

---

## Open questions (need Mitchell's answer before the relevant phase)

- **OQ1 (Phase 1).** Asymmetric algorithm — RSA-OAEP 4096 (universal browser
  support, slower) or Curve25519 via WebCrypto subtle / sodium polyfill
  (faster, smaller, less universal)? Default: **RSA-OAEP 4096** unless
  Mitchell wants to add a WASM dependency.

yes RSA-OAEP 4096

- **OQ2 (Phase 3).** TOTP secret storage — stored encrypted inside the
  entry blob (true zero-knowledge) or with a server-side KEK like Mark's
  vault (server can re-issue codes but theoretically reads them)?
  Recommendation: **inside the entry blob** for consistency with D1. 

stored encrypted inside the entry blob

- **OQ3 (Phase 5).** MFA on vault unlock — WebAuthn / passkey support, or
  TOTP, or none? Recommendation: defer to Phase 6+ unless a specific
  staff threat warrants it.

defer. 

---

## Reference

- Mark Pearce's standalone vault (`centrefit-vault.zip`, 2026-05-18) — PHP
  + Crazy Domains, single-user. We borrow the crypto module shape (PBKDF2
  600k, AES-256-GCM, bcrypt cost 12) and the security headers / session
  lifecycle thinking. Folder/share model is net-new.
- 1Password Teams whitepaper — reference for the per-folder key wrapping
  pattern (they call it "vault sharing").
- Bitwarden organization vault — reference for the simpler server-encrypted
  model we explicitly rejected (D1).
