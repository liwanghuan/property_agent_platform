// Refreshes the Supabase session cookie on each request and sends signed-out visitors to /login.
// This is an optimistic check only; data access is enforced by RLS.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "./env";

const PUBLIC_PREFIXES = ["/login", "/p/", "/v/", "/api/whatsapp/", "/api/dev/"];

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Dev-only routes (e.g. the WhatsApp simulator) must not exist in production builds.
  if (path.startsWith("/api/dev/") && process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }
  if (path === "/api/health") return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && !PUBLIC_PREFIXES.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
