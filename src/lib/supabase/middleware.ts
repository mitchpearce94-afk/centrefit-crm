import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  // Redirect unauthenticated users to login (except for auth routes and
  // explicitly public endpoints which do their own secret-header auth)
  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/forgot-password") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    !request.nextUrl.pathname.startsWith("/api/auth/forgot-password") &&
    !request.nextUrl.pathname.startsWith("/api/seed-") &&
    !request.nextUrl.pathname.startsWith("/api/quotes/respond") &&
    !request.nextUrl.pathname.startsWith("/api/quotes/by-token/") &&
    !request.nextUrl.pathname.startsWith("/api/nbn-enquiries/create") &&
    !request.nextUrl.pathname.startsWith("/api/xero/webhook") &&
    !request.nextUrl.pathname.startsWith("/api/gocardless/webhook") &&
    !request.nextUrl.pathname.startsWith("/api/recurring-plans/complete") &&
    !request.nextUrl.pathname.startsWith("/quote-response") &&
    !request.nextUrl.pathname.startsWith("/recurring-thanks")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login
  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
