import { Suspense } from "react";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

async function login(formData: FormData) {
  "use server";
  try {
    await signIn("credentials", { email: formData.get("email"), password: formData.get("password"), redirectTo: "/" });
  } catch (e) {
    if (e instanceof AuthError) redirect("/login?error=1");
    throw e;
  }
}

async function ErrorNote({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  if (!sp.error) return null;
  return <p role="alert" className="mb-4 rounded-md bg-[#f4dcd8] px-3 py-2 text-[13px] text-[#7c2a21]">Wrong email or password (accounts lock for 15 min after 5 failures).</p>;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--forest)] px-4">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--ivory)] p-8 shadow-2xl">
        <p className="font-[family-name:var(--font-display)] text-3xl text-primary">
          Thesis<span className="text-[var(--gold)]">Desk</span>
        </p>
        <p className="mb-6 mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">All In Capital · sign in</p>
        <Suspense fallback={null}><ErrorNote searchParams={searchParams} /></Suspense>
        <form action={login} className="space-y-3">
          <label className="block text-[13px] font-medium">Email
            <input name="email" type="email" required autoComplete="username" className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <label className="block text-[13px] font-medium">Password
            <input name="password" type="password" required minLength={8} autoComplete="current-password" className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <button className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">Sign in</button>
        </form>
        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">Accounts are created by a partner. No Google sign-in.</p>
      </div>
    </div>
  );
}
