"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ensureMafiaProfile } from "../lib/mafiaProfile";
import { supabase } from "../lib/supabase";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signupError) {
      setError(signupError.message);
      setIsLoading(false);
      return;
    }

    try {
      if (data.user) {
        await ensureMafiaProfile(data.user);
      }
    } catch {
      setError("Account created, but profile setup needs another try.");
      setIsLoading(false);
      return;
    }

    router.push("/profile");
  }

  async function handleGoogleSignup() {
    setError("");
    setIsLoading(true);

    const { error: googleError } = await supabase.auth.signInWithOAuth({
      options: {
        redirectTo: `${window.location.origin}/profile`,
      },
      provider: "google",
    });

    if (googleError) {
      setError(googleError.message);
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 py-10 text-white">
      <section className="w-full max-w-sm">
        <p className="text-sm font-medium uppercase tracking-[0.35em] text-emerald-300">
          Mafia Party Game
        </p>
        <h1 className="mt-4 text-4xl font-bold">Create Account</h1>

        <form onSubmit={handleSignup} className="mt-8 flex flex-col gap-4">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="min-h-14 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-lg outline-none transition placeholder:text-zinc-500 focus:border-red-400"
            placeholder="Email"
            type="email"
            required
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="min-h-14 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-lg outline-none transition placeholder:text-zinc-500 focus:border-red-400"
            placeholder="Password"
            type="password"
            required
          />

          <button
            disabled={isLoading}
            className="min-h-16 rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700 active:scale-[0.98]"
            type="submit"
          >
            {isLoading ? "Creating..." : "Sign Up"}
          </button>
        </form>

        <button
          onClick={handleGoogleSignup}
          disabled={isLoading}
          className="mt-4 min-h-16 w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-lg font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]"
          type="button"
        >
          Continue with Google
        </button>

        {error ? <p className="mt-4 text-sm font-medium text-red-300">{error}</p> : null}

        <p className="mt-6 text-center text-sm text-zinc-400">
          Already have an account?{" "}
          <Link className="font-bold text-emerald-200" href="/login">
            Log in
          </Link>
        </p>
      </section>
    </main>
  );
}
