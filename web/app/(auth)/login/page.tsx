"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const DEMO_PASSWORD = "AnuDemo2026!";
const DEMO_ACCOUNTS = [
  { label: "Roofing contractor", email: "demo@anu.dev", note: "6 completed reports across varied roofs" },
  { label: "Solo operator", email: "solo@anu.dev", note: "a lighter, recent workload" },
];

export default function LoginPage() {
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
    <>
      <h1 className="text-2xl font-bold mb-1 text-gray-900">Sign in to Anu</h1>
      <p className="text-sm text-gray-500 mb-6">Roof intelligence from the sky.</p>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1 text-gray-700">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1 text-gray-700">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-sm text-center text-gray-600">
        Don&apos;t have an account?{" "}
        <a href="/register" className="text-blue-600 hover:underline">Register</a>
      </p>

      {/* demo accounts */}
      <div className="mt-8 border-t border-gray-200 pt-6">
        <div className="flex items-center gap-2 mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          <span aria-hidden>🔑</span> Demo accounts
        </div>
        <div className="space-y-2">
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.email}
              type="button"
              onClick={() => fillDemo(a.email)}
              className="w-full text-left rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 transition hover:border-blue-300 hover:bg-blue-50"
            >
              <div className="text-sm font-semibold text-gray-900">{a.label}</div>
              <div className="text-xs text-gray-500">{a.email}</div>
              <div className="mt-0.5 text-[11px] text-gray-400">{a.note}</div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Shared password:{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-700">{DEMO_PASSWORD}</code>
        </p>
        <p className="mt-1 text-[11px] text-gray-400">Click an account to fill the form, then Sign in.</p>
      </div>
    </>
  );
}
