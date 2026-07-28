import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session security policy (Phase 0 of vault rollout):
 *
 *   - IDLE_TIMEOUT_MS — sliding window. Each authenticated request bumps the
 *     `cf-last-activity` cookie to now. If a request arrives with the cookie
 *     stale by more than this window, we sign the user out.
 *   - MAX_SESSION_MS — hard cap from first authenticated request. Set the
 *     `cf-session-started` cookie when missing; if exceeded, sign out.
 *
 * Both checks live in middleware so that the very next navigation after
 * idleness redirects to /login. The IdleLogout client component (mounted
 * in the dashboard layout) handles the "tab left open overnight" case by
 * triggering a signOut even without user navigation.
 */
// Idle went 30min → 4h on 2026-07-06: the aggressive window was
// compensating for password-only logins; with TOTP MFA enforced, one MFA
// login per workday (12h cap) is the stronger overall posture. The vault
// keeps its own unlock regardless.
const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000;    // 4 hours
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;    // 12 hours
// Passkey-authenticated sessions get a longer hard cap (Mitchell 2026-07-28):
// a passkey login is possession + biometric in one phishing-resistant ceremony
// and re-auth after idle is a one-tap Face ID, so the phone experience is
// "open and you're in" without weakening the password+TOTP posture — those
// sessions keep the 12h cap. Idle stays 4h for everyone.
const PASSKEY_MAX_SESSION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

const LAST_ACTIVITY_COOKIE = "cf-last-activity";
const SESSION_STARTED_COOKIE = "cf-session-started";

// The enforcement cookies MUST outlive the windows they measure — a cookie
// that expires with the window deletes the very evidence of staleness (the
// original bug: idle > 4h meant the browser dropped cf-last-activity, the
// check was skipped as "first request", and nobody ever idled out).
const ENFORCEMENT_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

// Stable id for the current Supabase login session, from the JWT's session_id
// claim. Stamping it into the enforcement cookies scopes them to ONE login:
// a fresh sign-in gets fresh windows even though the cookies now long outlive
// the session.
function sessionIdFromJwt(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { session_id?: string };
    return claims.session_id ?? null;
  } catch {
    return null;
  }
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

// Routes that bypass auth entirely (public endpoints, webhooks, the public
// recurring-signup form, etc.) Pulled out so the timeout check skips them too —
// otherwise a Stripe/GC webhook would never set our session cookies and we'd
// fight ourselves on every callback.
const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/forgot-password",
  "/auth",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/reset-password",
  "/api/quotes/respond",
  "/api/quotes/by-token/",
  "/api/nbn-enquiries/create",
  "/api/xero/webhook",
  "/api/gocardless/webhook",
  "/api/resend/webhook",
  "/api/cron/",
  "/api/public/",
  "/quote-response",
  "/recurring-thanks",
  "/status-board",
  "/monitoring-form",
  "/handover",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function redirectToLogin(request: NextRequest, reason: "idle" | "expired" | null) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = reason ? `?reason=${reason}` : "";
  const res = NextResponse.redirect(url);
  // Clear our own activity cookies so the next login starts fresh.
  res.cookies.set(LAST_ACTIVITY_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  res.cookies.set(SESSION_STARTED_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return res;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session — don't remove this
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublic = isPublicPath(pathname);

  // ── MFA state (security hardening 2026-07-06) ────────────────────────────
  // TOTP is ENFORCED for every staff account: no verified factor → forced
  // enrolment; verified factor but aal1 session → verify step. Computed from
  // the local session JWT (no network call).
  const onMfaVerify = pathname === "/login/mfa";
  const onMfaSetup = pathname === "/login/mfa-setup";
  let needsVerify = false;
  let needsEnrol = false;
  let passkeyAuthed = false;
  if (user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    // A passkey sign-in is possession + biometric in one phishing-resistant
    // ceremony — treated as MFA-satisfied, no TOTP step. Detected from the
    // session's AMR claim (entries may be strings or {method} objects).
    const methods = (aal?.currentAuthenticationMethods ?? []) as Array<string | { method: string }>;
    passkeyAuthed = methods.some((m) => {
      const name = typeof m === "string" ? m : m?.method ?? "";
      return name.includes("passkey") || name.includes("webauthn");
    });
    if (!passkeyAuthed) {
      needsVerify = aal?.nextLevel === "aal2" && aal?.currentLevel !== "aal2";
      needsEnrol = aal?.nextLevel === "aal1";
    }
  }

  function redirectTo(path: string) {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Redirect unauthenticated users to login (except for auth routes and
  // explicitly public endpoints which do their own secret-header auth)
  if (!user && !isPublic) {
    return redirectToLogin(request, null);
  }

  // MFA gate — an aal1 session can't touch anything non-public.
  if (user && !isPublic) {
    if (needsVerify) return redirectTo("/login/mfa");
    if (needsEnrol) return redirectTo("/login/mfa-setup");
  }

  // Authenticated request on a non-public path → enforce idle + max session.
  if (user && !isPublic) {
    const now = Date.now();
    // Cookie format "sessionId:timestamp" — a stamp only counts when it was
    // written by THIS login session, so re-logins start fresh windows and
    // legacy plain-timestamp cookies are treated as absent.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const sid = sessionIdFromJwt(session?.access_token) ?? user.id;

    const readStamp = (raw: string | undefined): number | null => {
      if (!raw) return null;
      const [cookieSid, ts] = raw.split(":");
      if (cookieSid !== sid) return null;
      const n = Number(ts);
      return Number.isFinite(n) ? n : null;
    };

    const lastActivity = readStamp(request.cookies.get(LAST_ACTIVITY_COOKIE)?.value);
    const sessionStarted = readStamp(request.cookies.get(SESSION_STARTED_COOKIE)?.value);

    // Idle check — first request of a login session has no stamp yet, so we
    // skip and set it below.
    if (lastActivity && now - lastActivity > IDLE_TIMEOUT_MS) {
      await supabase.auth.signOut();
      return redirectToLogin(request, "idle");
    }

    // Hard-cap check — independent of activity. Password+TOTP sessions cap at
    // 12h; passkey sessions at 14 days (see PASSKEY_MAX_SESSION_MS).
    const maxSessionMs = passkeyAuthed ? PASSKEY_MAX_SESSION_MS : MAX_SESSION_MS;
    if (sessionStarted && now - sessionStarted > maxSessionMs) {
      await supabase.auth.signOut();
      return redirectToLogin(request, "expired");
    }

    // Bump activity (sliding window) and set session-started on first request.
    supabaseResponse.cookies.set(LAST_ACTIVITY_COOKIE, `${sid}:${now}`, {
      ...COOKIE_OPTIONS,
      maxAge: ENFORCEMENT_COOKIE_MAX_AGE_S,
    });
    if (!sessionStarted) {
      supabaseResponse.cookies.set(SESSION_STARTED_COOKIE, `${sid}:${now}`, {
        ...COOKIE_OPTIONS,
        maxAge: ENFORCEMENT_COOKIE_MAX_AGE_S,
      });
    }
  }

  // Admin-segment hard gate: every /api/admin/* route requires the admin
  // role. Belt-and-braces single chokepoint — several admin routes
  // historically checked only "is logged in", letting any authenticated
  // staffer trigger destructive Xero/recurring ops (audit 2026-06-01).
  if (user && pathname.startsWith("/api/admin")) {
    const { data: me } = await supabase
      .from("staff")
      .select("role")
      .eq("id", user.id)
      .single();
    if (me?.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden — admin access required" },
        { status: 403 },
      );
    }
  }

  // Login + MFA page routing for authenticated users: each page only serves
  // its own state; anything else moves along (prevents loops).
  if (user) {
    if (pathname === "/login") {
      return redirectTo(needsVerify ? "/login/mfa" : needsEnrol ? "/login/mfa-setup" : "/");
    }
    if (onMfaVerify && !needsVerify) {
      return redirectTo(needsEnrol ? "/login/mfa-setup" : "/");
    }
    if (onMfaSetup && needsVerify) {
      return redirectTo("/login/mfa");
    }
    if (onMfaSetup && !needsEnrol) {
      return redirectTo("/");
    }
  }

  return supabaseResponse;
}
