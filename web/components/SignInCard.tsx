"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const DEMO_PASSWORD = "AnuDemo2026!";
const DEMO_ACCOUNTS = [
  { label: "Roofing contractor", email: "demo@anu.dev", note: "6 completed reports across varied roofs" },
  { label: "Solo operator", email: "solo@anu.dev", note: "a lighter, recent workload" },
];

export default function SignInCard() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (result?.error) setError("Invalid email or password");
    else router.push("/dashboard");
  }

  function fillDemo(addr: string) {
    setEmail(addr);
    setPassword(DEMO_PASSWORD);
    setError("");
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-[#15233b]">Sign in to Anu</h2>
      <p className="mt-1 text-sm text-slate-500">Try it instantly with a demo account — completely free.</p>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1 text-slate-700">Email</label>
          <input
            id="email" name="email" type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-[#15233b] outline-none focus:border-[#15233b]"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1 text-slate-700">Password</label>
          <input
            id="password" name="password" type="password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-[#15233b] outline-none focus:border-[#15233b]"
          />
        </div>
        <button
          type="submit" disabled={loading}
          className="w-full rounded-lg bg-[#15233b] px-4 py-2.5 font-medium text-white transition hover:bg-[#22324f] disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-600">
        Don&apos;t have an account? <a href="/register" className="font-medium text-[#b07d28] hover:underline">Register</a>
      </p>

      <div className="mt-7 border-t border-slate-200 pt-6">
        <div className="mb-3 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          <span aria-hidden>🔑</span> Demo accounts
        </div>
        <div className="space-y-2">
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.email} type="button" onClick={() => fillDemo(a.email)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-[#e8b34a] hover:bg-[#fcf6e8]"
            >
              <div className="text-sm font-semibold text-[#15233b]">{a.label}</div>
              <div className="text-xs text-slate-500">{a.email}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">{a.note}</div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Shared password:{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">{DEMO_PASSWORD}</code>
        </p>
        <p className="mt-1 text-[11px] text-slate-400">Click an account to fill the form, then Sign in.</p>
      </div>
    </div>
  );
}
