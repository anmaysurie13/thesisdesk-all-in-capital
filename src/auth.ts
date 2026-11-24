import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, type Role } from "@/db/schema";
import { audit } from "@/lib/audit";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role } & DefaultSession["user"];
  }
}

const Login = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });
const MAX_FAILS = 5;

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 12 * 3600 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const p = Login.safeParse(raw);
        if (!p.success) return null;
        const email = p.data.email.toLowerCase();
        const [u] = await db().select().from(users).where(eq(users.email, email));
        if (!u || !u.active) return null;
        if (u.lockedUntil && u.lockedUntil > new Date()) {
          await audit({ id: u.id, role: u.role }, "auth.locked", "user", u.id, {}, false);
          return null;
        }
        const ok = await bcrypt.compare(p.data.password, u.passwordHash);
        if (!ok) {
          const fails = u.failedLogins + 1;
          await db().update(users).set({
            failedLogins: fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + 15 * 60_000) : null,
          }).where(eq(users.id, u.id));
          await audit({ id: u.id, role: u.role }, "auth.failed", "user", u.id, { fails }, false);
          return null;
        }
        await db().update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
        await audit({ id: u.id, role: u.role }, "auth.login", "user", u.id, {});
        return { id: u.id, email: u.email, name: u.name, role: u.role } as { id: string; email: string; name: string; role: Role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = (user as { role: Role }).role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid as string;
      session.user.role = token.role as Role;
      return session;
    },
    authorized({ auth: s, request }) {
      // OPEN_ACCESS: anyone may VIEW the dashboard; every mutation still requires a signed-in role (checked server-side).
      if (process.env.OPEN_ACCESS !== "false") return true;
      const p = request.nextUrl.pathname;
      if (p.startsWith("/login") || p.startsWith("/api/auth") || p.startsWith("/api/webhooks") || p.startsWith("/api/worker") || p.startsWith("/api/health")) return true;
      if (p.startsWith("/api/v1")) return true; // token-authenticated harness API (checked in the route)
      return !!s?.user;
    },
  },
});
