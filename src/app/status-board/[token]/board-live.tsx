"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * TV-board heartbeat: shows a live clock and silently re-fetches the server
 * component every REFRESH_MS so the board stays current without anyone touching
 * it. router.refresh() re-runs the page's server data fetch in place (no flash).
 *
 * Self-healing (added after the 2026-06-10 domain outage left the TV wedged
 * on Vercel's error page): a health ping runs alongside the refresh — if the
 * site was unreachable and comes back, we hard-reload to guarantee a clean
 * app; and once a day (~3am) we hard-reload anyway so a TV browser that's
 * been running for weeks never rots.
 */
const REFRESH_MS = 60_000;
const DAILY_RELOAD_HOUR = 3;

export function BoardLive() {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    let wasDown = false;
    const tick = setInterval(() => setNow(new Date()), 1000);
    const refresh = setInterval(async () => {
      try {
        const res = await fetch(window.location.href, { method: "HEAD", cache: "no-store" });
        if (!res.ok) { wasDown = true; return; }
        if (wasDown) { window.location.reload(); return; }
        router.refresh();
      } catch {
        wasDown = true; // offline/outage — keep showing last data, retry next tick
      }
      const d = new Date();
      if (d.getHours() === DAILY_RELOAD_HOUR && d.getMinutes() < 2) window.location.reload();
    }, REFRESH_MS);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [router]);

  return (
    <div className="text-right">
      <div className="text-3xl font-semibold tabular-nums text-white/90">
        {now
          ? now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })
          : " "}
      </div>
      <div className="text-sm text-white/40">
        {now
          ? now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })
          : " "}
      </div>
    </div>
  );
}
