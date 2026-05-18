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
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;        // 30 minutes
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;    // 12 hours

const LAST_ACTIVITY_COOKIE = "cf-last-activity";
const SESSION_STARTED_COOKIE = "cf-session-started";

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
  "/api/seed-",
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

  // Redirect unauthenticated users to login (except for auth routes and
  // explicitly public endpoints which do their own secret-header auth)
  if (!user && !isPublic) {
    return redirectToLogin(request, null);
  }

  // Authenticated request on a non-public path → enforce idle + max session.
  if (user && !isPublic) {
    const now = Date.now();
    const lastActivityRaw = request.cookies.get(LAST_ACTIVITY_COOKIE)?.value;
    const sessionStartedRaw = request.cookies.get(SESSION_STARTED_COOKIE)?.value;

    const lastActivity = lastActivityRaw ? Number(lastActivityRaw) : null;
    const sessionStarted = sessionStartedRaw ? Number(sessionStartedRaw) : null;

    // Idle check — only triggers if the cookie was set previously and has gone
    // stale. First request after login has no cookie yet, so we skip and set
    // it below.
    if (lastActivity && Number.isFinite(lastActivity) && now - lastActivity > IDLE_TIMEOUT_MS) {
      await supabase.auth.signOut();
      return redirectToLogin(request, "idle");
    }

    // Hard-cap check — independent of activity. If the user has been on this
    // session for 12 hours straight, force a fresh login.
    if (sessionStarted && Number.isFinite(sessionStarted) && now - sessionStarted > MAX_SESSION_MS) {
      await supabase.auth.signOut();
      return redirectToLogin(request, "expired");
    }

    // Bump activity (sliding window) and set session-started on first request.
    supabaseResponse.cookies.set(LAST_ACTIVITY_COOKIE, String(now), {
      ...COOKIE_OPTIONS,
      maxAge: Math.floor(IDLE_TIMEOUT_MS / 1000),
    });
    if (!sessionStarted || !Number.isFinite(sessionStarted)) {
      supabaseResponse.cookies.set(SESSION_STARTED_COOKIE, String(now), {
        ...COOKIE_OPTIONS,
        maxAge: Math.floor(MAX_SESSION_MS / 1000),
      });
    }
  }

  // Redirect authenticated users away from login
  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
