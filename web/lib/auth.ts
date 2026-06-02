import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Required on non-Vercel hosts (Cloudflare Workers / *.workers.dev): Auth.js
  // refuses requests otherwise with "UntrustedHost".
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        // Brute-force protection: cap login attempts per CLIENT IP. Generous so
        // legitimate users (incl. demo accounts being clicked through) are never
        // blocked. Use Cloudflare's real client-IP header, not x-forwarded-for.
        try {
          const h = (request as Request | undefined)?.headers;
          const ip = h?.get?.("cf-connecting-ip") || h?.get?.("x-forwarded-for") || "unknown";
          const limit = await rateLimit(`login:${ip}`, 50, 900);
          if (!limit.allowed) return null;
        } catch {
          // Rate limiter unavailable — fail open (auth still verifies the password).
        }

        const db = getDb();
        const user = await db.query.users.findFirst({
          where: eq(users.email, credentials.email as string),
        });

        if (!user || !user.passwordHash) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
    // Google OAuth is env-gated. To enable, also need Account model + PrismaAdapter.
    ...(process.env.GOOGLE_CLIENT_ID
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
