import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";

const VALID_ROLES = ["admin", "finance_manager", "project_manager", "field_staff"] as const;
type StaffRole = (typeof VALID_ROLES)[number];

const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Admin",
  finance_manager: "Finance Manager",
  project_manager: "Project Manager",
  field_staff: "Field Staff",
};

interface InviteBody {
  email: string;
  display_name: string;
  initials?: string | null;
  role: StaffRole;
  phone?: string | null;
}

/**
 * Generates a memorable but reasonably-strong temporary password.
 * Format: word-word-####  (e.g. "harbour-marine-7142"). Easy to read out
 * loud, hard to guess, and the user is forced to change it on first login.
 */
function generateTempPassword(): string {
  const words = [
    "harbour", "summit", "ranger", "anchor", "boulder", "cobalt",
    "delta", "ember", "frost", "granite", "horizon", "ivory",
    "junction", "lantern", "marina", "quartz", "ranger", "shore",
  ];
  const w1 = words[crypto.randomInt(0, words.length)];
  const w2 = words[crypto.randomInt(0, words.length)];
  const num = crypto.randomInt(1000, 10000);
  return `${w1}-${w2}-${num}`;
}

export async function POST(req: NextRequest) {
  let body: InviteBody;
  try {
    body = (await req.json()) as InviteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.email?.trim() || !body.display_name?.trim() || !body.role) {
    return NextResponse.json(
      { error: "email, display_name and role are required" },
      { status: 400 },
    );
  }
  if (!VALID_ROLES.includes(body.role)) {
    return NextResponse.json(
      { error: `role must be one of ${VALID_ROLES.join(", ")}` },
      { status: 400 },
    );
  }

  // Caller must be an admin
  const supabase = await createClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();
  if (!caller) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: callerStaff } = await supabase
    .from("staff")
    .select("role, display_name")
    .eq("id", caller.id)
    .single();
  if (callerStaff?.role !== "admin") {
    return NextResponse.json({ error: "Only admins can invite staff" }, { status: 403 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 },
    );
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: "Server is missing RESEND_API_KEY" }, { status: 500 });
  }

  const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const email = body.email.trim().toLowerCase();
  const displayName = body.display_name.trim();
  const initials = (body.initials?.trim() || displayName.slice(0, 2)).toUpperCase().slice(0, 3);
  const tempPassword = generateTempPassword();
  const loginUrl = `${req.nextUrl.origin}/login`;

  // Look up an existing user with this email — if one exists (e.g. previous
  // broken invite where the magic link was eaten by an email scanner), reset
  // its password instead of failing on "already registered".
  const { data: pageData } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = pageData?.users.find((u) => u.email?.toLowerCase() === email);

  let userId: string;
  if (existing) {
    userId = existing.id;
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password: tempPassword,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (updErr) {
      return NextResponse.json(
        { error: `Failed to reset existing user's password: ${updErr.message}` },
        { status: 502 },
      );
    }
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (createErr || !created.user) {
      return NextResponse.json(
        { error: `Failed to create user: ${createErr?.message ?? "unknown"}` },
        { status: 502 },
      );
    }
    userId = created.user.id;
  }

  // The handle_new_user trigger created the staff row when the auth user was
  // first inserted (during this call for new users, or earlier for existing
  // ones). Update it now with the requested role + nicer defaults.
  const { error: staffErr } = await admin
    .from("staff")
    .update({
      display_name: displayName,
      initials,
      role: body.role,
      phone: body.phone?.trim() || null,
      is_active: true,
      must_change_password: true,
    })
    .eq("id", userId);
  if (staffErr) {
    return NextResponse.json(
      {
        error: `User created/updated but staff row update failed: ${staffErr.message}`,
        userId,
      },
      { status: 500 },
    );
  }

  // Send the credentials via Resend on the verified centrefit.com.au domain.
  const inviterName = callerStaff.display_name ?? caller.email ?? "Centrefit";
  const html = emailLayout(`
    ${emailHeader({ rightLabel: "CRM Invite" })}
    <tr><td style="padding:32px 32px 8px">
      <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 8px">You're invited to the Centrefit CRM</h1>
      <p style="margin:0 0 16px;font-size:13px;color:#475569;line-height:1.55">${inviterName} added you to the Centrefit CRM as <strong>${ROLE_LABELS[body.role]}</strong>.</p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin:18px 0">
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700">Login URL</p>
        <p style="margin:0 0 14px;font-family:monospace;font-size:13px;color:#0f172a">${loginUrl}</p>
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700">Email</p>
        <p style="margin:0 0 14px;font-family:monospace;font-size:13px;color:#0f172a">${email}</p>
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700">Temporary password</p>
        <p style="margin:0;font-family:monospace;font-size:16px;font-weight:600;color:#0f172a;letter-spacing:0.5px">${tempPassword}</p>
      </div>

      <p style="margin:16px 0;text-align:center">
        <a href="${loginUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Sign in to the CRM</a>
      </p>

      <p style="margin:24px 0 0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.5">
        You'll be prompted to set a new password on first login. If you weren't expecting this, ignore this email or reply to let us know.
      </p>
    </td></tr>
    ${emailFooter()}
  `);

  try {
    const resend = new Resend(resendKey);
    const { error: sendErr } = await resend.emails.send({
      from: "Centrefit CRM <noreply@centrefit.com.au>",
      to: email,
      subject: "Your Centrefit CRM invitation",
      html,
      replyTo: caller.email ?? "admin@centrefit.com.au",
    });
    if (sendErr) {
      return NextResponse.json(
        {
          error: `User set up but invite email failed: ${sendErr.message}. Temp password: ${tempPassword}`,
          userId,
          tempPassword,
        },
        { status: 502 },
      );
    }
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: `User set up but invite email failed: ${err instanceof Error ? err.message : String(err)}. Temp password: ${tempPassword}`,
        userId,
        tempPassword,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    userId,
    email,
  });
}
