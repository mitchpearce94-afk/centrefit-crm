import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Admin MFA reset (lost/replaced phone). Deletes every MFA factor AND every
 * passkey on the target staff account — their next login falls back to
 * password + forced re-enrolment on /login/mfa-setup. The /api/admin/*
 * middleware chokepoint already hard-gates this to role === 'admin'.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: staffId } = await ctx.params;
  const sb = createServiceRoleClient();

  const { data, error } = await sb.auth.admin.mfa.listFactors({ userId: staffId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let removed = 0;
  for (const factor of data?.factors ?? []) {
    const { error: delError } = await sb.auth.admin.mfa.deleteFactor({ id: factor.id, userId: staffId });
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });
    removed++;
  }

  // Passkeys go too — a lost device means both credential types are gone.
  const { data: pkData } = await sb.auth.admin.passkey.listPasskeys({ userId: staffId });
  const passkeys = (pkData as { passkeys?: { id: string }[] } | { id: string }[] | null | undefined);
  const list = Array.isArray(passkeys) ? passkeys : passkeys?.passkeys ?? [];
  for (const pk of list) {
    const { error: pkError } = await sb.auth.admin.passkey.deletePasskey({ userId: staffId, passkeyId: pk.id });
    if (pkError) return NextResponse.json({ error: pkError.message }, { status: 500 });
    removed++;
  }

  return NextResponse.json({ success: true, removed });
}
