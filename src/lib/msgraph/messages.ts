import "server-only";
import { graphFetch } from "@/lib/msgraph/client";

export interface GraphMessage {
  id: string;
  internetMessageId: string | null;
  subject: string | null;
  receivedDateTime: string;
  webLink: string | null;
  hasAttachments: boolean;
  from: { emailAddress: { name: string | null; address: string | null } } | null;
  body: { contentType: string; content: string } | null;
  bodyPreview: string | null;
}

/**
 * New messages in a mailbox's Inbox since the watermark, oldest first.
 * Inbox folder only — triage must never touch Sent/Drafts/Junk. Body is
 * requested as text (Prefer header) so the classifier never sees HTML soup.
 */
export async function listInboxMessagesSince(
  mailbox: string,
  sinceIso: string,
  top = 25,
): Promise<GraphMessage[]> {
  const filter = encodeURIComponent(`receivedDateTime gt ${sinceIso}`);
  const select = "id,internetMessageId,subject,receivedDateTime,webLink,hasAttachments,from,body,bodyPreview";
  const data = await graphFetch<{ value: GraphMessage[] }>(
    `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$filter=${filter}&$orderby=receivedDateTime asc&$top=${top}&$select=${select}`,
    { headers: { Prefer: 'outlook.body-content-type="text"' } },
  );
  return data.value ?? [];
}

/**
 * Forward a message (attachments included) — used to shuttle supplier bills
 * to the Xero Bills inbox. Internal destination only; never a customer (D7).
 */
export async function forwardMessage(
  mailbox: string,
  messageId: string,
  to: string,
  comment: string,
): Promise<void> {
  await graphFetch<void>(
    `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/forward`,
    {
      method: "POST",
      body: JSON.stringify({
        comment,
        toRecipients: [{ emailAddress: { address: to } }],
      }),
    },
  );
}

/** Stamp Outlook categories on a message so triage decisions are visible in the mailbox. */
export async function setMessageCategories(
  mailbox: string,
  messageId: string,
  categories: string[],
): Promise<void> {
  await graphFetch<void>(
    `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}`,
    { method: "PATCH", body: JSON.stringify({ categories }) },
  );
}

export async function markMessageRead(mailbox: string, messageId: string): Promise<void> {
  await graphFetch<void>(
    `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}`,
    { method: "PATCH", body: JSON.stringify({ isRead: true }) },
  );
}

// Per-run cache of the "Assistant" folder id per mailbox.
const folderCache = new Map<string, string>();

/**
 * Get-or-create the top-level "Assistant" folder where live-mode triage files
 * noise (Mitchell's call 2026-07-29: noise = tag + mark read + move; nothing
 * is ever deleted).
 */
export async function getAssistantFolderId(mailbox: string): Promise<string> {
  const cached = folderCache.get(mailbox);
  if (cached) return cached;

  const existing = await graphFetch<{ value: Array<{ id: string; displayName: string }> }>(
    `/users/${encodeURIComponent(mailbox)}/mailFolders?$filter=displayName eq 'Assistant'&$select=id,displayName`,
  );
  let id = existing.value?.[0]?.id;
  if (!id) {
    const created = await graphFetch<{ id: string }>(
      `/users/${encodeURIComponent(mailbox)}/mailFolders`,
      { method: "POST", body: JSON.stringify({ displayName: "Assistant" }) },
    );
    id = created.id;
  }
  folderCache.set(mailbox, id);
  return id;
}

/** Move a message. NOTE: Graph assigns a NEW message id after a move — apply categories/read flags BEFORE moving. */
export async function moveMessage(
  mailbox: string,
  messageId: string,
  destinationFolderId: string,
): Promise<void> {
  await graphFetch<void>(
    `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/move`,
    { method: "POST", body: JSON.stringify({ destinationId: destinationFolderId }) },
  );
}
