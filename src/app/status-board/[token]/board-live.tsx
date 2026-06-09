"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * TV-board heartbeat: shows a live clock and silently re-fetches the server
 * component every REFRESH_MS so the board stays current without anyone touching
 * it. router.refresh() re-runs the page's server data fetch in place (no flash).
 */
const REFRESH_MS = 60_000;

export function BoardLive() {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 1000);
    const refresh = setInterval(() => router.refresh(), REFRESH_MS);
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
