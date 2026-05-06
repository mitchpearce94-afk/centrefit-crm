"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Notification bell + dropdown for the dashboard sidebar / top bar. Polls
 * unread count every 60s when the panel is closed; loads the most recent
 * 20 rows when opened. Click a row to mark-read and navigate to the
 * linked CRM page (href stored on the notification).
 *
 * Real-time delivery via Supabase Realtime is staged for the next pass —
 * polling keeps the v1 simple and avoids holding a websocket on every
 * dashboard tab. 60s lag is acceptable for the events we currently fire.
 */

interface NotificationRow {
  id: string;
  type_code: string;
  ref_type: string;
  ref_id: string;
  title: string;
  body: string | null;
  href: string | null;
  created_at: string;
  read_at: string | null;
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  async function loadCount() {
    const supabase = createClient();
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    setUnread(count ?? 0);
  }

  async function loadRows() {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("id, type_code, ref_type, ref_id, title, body, href, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setRows((data ?? []) as NotificationRow[]);
    setLoading(false);
  }

  // Initial count + poll every 60s while the panel is closed.
  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 60_000);
    return () => clearInterval(t);
  }, []);

  // Admin check — only admins see the gear-cog shortcut to /staff so they
  // can edit anyone's preferences. Non-admins have no per-user prefs UI
  // (intentionally — admin manages notification routing centrally).
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
      setIsAdmin(data?.role === "admin");
    })();
  }, []);

  // Click outside / Esc closes the panel.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function togglePanel() {
    const next = !open;
    setOpen(next);
    if (next) await loadRows();
  }

  async function markAllRead() {
    const supabase = createClient();
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    setRows((rs) => rs.map((r) => r.read_at ? r : { ...r, read_at: new Date().toISOString() }));
    setUnread(0);
  }

  async function pickRow(row: NotificationRow) {
    if (!row.read_at) {
      const supabase = createClient();
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", row.id);
      setUnread((u) => Math.max(0, u - 1));
    }
    if (row.href) {
      setOpen(false);
      router.push(row.href);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={togglePanel}
        className="relative flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent transition-colors"
        aria-label={`Notifications ${unread > 0 ? `(${unread} unread)` : ""}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-1 right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 rounded-lg border border-border bg-card shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <span className="text-sm font-semibold">Notifications</span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] text-primary hover:underline"
                >
                  Mark all read
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => { setOpen(false); router.push("/staff"); }}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  title="Manage notifications for any staff (admin only)"
                >
                  ⚙
                </button>
              )}
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading && rows.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">Loading…</p>
            )}
            {!loading && rows.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">You&apos;re all caught up.</p>
            )}
            {rows.map((r) => (
              <button
                key={r.id}
                onClick={() => pickRow(r)}
                className={`w-full text-left px-4 py-2.5 border-b border-border hover:bg-accent transition-colors ${r.read_at ? "" : "bg-primary/5"}`}
              >
                <div className="flex items-start gap-2">
                  {!r.read_at && <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />}
                  <div className={`flex-1 min-w-0 ${r.read_at ? "" : "pl-0"}`}>
                    <div className="text-sm font-medium leading-snug">{r.title}</div>
                    {r.body && <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{r.body}</div>}
                    <div className="text-[11px] text-muted-foreground mt-1">{fmtRelative(r.created_at)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
