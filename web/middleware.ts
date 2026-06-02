import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Runs on the edge runtime (default). OpenNext Cloudflare does not support
// Node.js-runtime middleware, so this must not declare `runtime = "nodejs"`.
export async function middleware(req: NextRequest) {
  // Cryptographically verify the session JWT (not just cookie presence).
  // getToken validates the token signature against the secret, so a forged or
  // tampered cookie is rejected before reaching server-rendered dashboard pages.
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  });

  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
