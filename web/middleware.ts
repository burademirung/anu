import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Edge-runtime middleware (OpenNext Cloudflare doesn't support Node-runtime
// middleware). Verifies the session JWT before dashboard pages render.
export async function middleware(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
    // On https the cookie is `__Secure-authjs.session-token`; without this,
    // getToken looks for the non-secure name, never finds it, and bounces every
    // signed-in user back to sign-in.
    secureCookie: req.nextUrl.protocol === "https:",
  });

  if (!token) {
    // The home page hosts the sign-in form (there is no separate /login page).
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
