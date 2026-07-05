import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Authenticated proxy for the job-attachments bucket (security hardening
 * 2026-07-06). The bucket was public — anyone holding a URL could fetch
 * work photos, note attachments and key-info photos forever. It's now
 * PRIVATE and every stored URL points here instead: same-origin <img>
 * tags send the session cookie automatically, middleware enforces
 * auth + MFA, and this route streams the object via the service client.
 * Stored historical URLs were rewritten in the same migration
 * (20260706020000_job_attachments_private).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const objectPath = (path ?? []).map(decodeURIComponent).join("/");
  if (!objectPath || objectPath.includes("..")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const sb = createServiceRoleClient();
  const { data, error } = await sb.storage.from("job-attachments").download(objectPath);
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buf = Buffer.from(await data.arrayBuffer());
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
