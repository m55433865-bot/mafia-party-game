"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ensureMafiaProfile, isMafiaProfileComplete } from "../lib/mafiaProfile";
import { supabase } from "../lib/supabase";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [isCodeSent, setIsCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }

    const timer = window.setTimeout(() => setCooldown((current) => current - 1), 1000);

    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    const normalizedEmail = email.trim().toLowerCase();
    const { error: signupError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
    });

    console.log("OTP sent with type: signup");

    if (signupError) {
      setError(signupError.message);
      setIsLoading(false);
      return;
    }

    setPendingEmail(normalizedEmail);
    setIsCodeSent(true);
    setCooldown(45);
    setSuccessMessage("Enter the verification code from your email.");
    setIsLoading(false);
  }

  async function handleVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    setIsLoading(true);

    const normalizedEmail = pendingEmail.trim().toLowerCase();
    const normalizedToken = otpCode.replace(/\s/g, "").trim();

    console.log("OTP verifying with type: signup");

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: normalizedToken,
      type: "signup",
    });

    if (verifyError || !data.user) {
      console.error("Supabase verifyOtp error:", verifyError);
      setError(verifyError?.message ?? "That code did not work.");
      setIsLoading(false);
      return;
    }

    try {
      const profile = await ensureMafiaProfile(data.user);
      router.push(isMafiaProfileComplete(profile) ? "/" : "/profile");
    } catch {
      setError("Account created, but profile setup needs another try.");
      setIsLoading(false);
    }
  }

  async function handleResendCode() {
    if (cooldown > 0 || !pendingEmail) {
      return;
    }

    setError("");
    setSuccessMessage("");
    setIsLoading(true);

    const { error: resendError } = await supabase.auth.resend({
      email: pendingEmail,
      type: "signup",
    });

    console.log("OTP sent with type: signup");

    if (resendError) {
      setError(resendError.message);
      setIsLoading(false);
      return;
    }

    setCooldown(45);
    setSuccessMessage("A new verification code was sent.");
    setIsLoading(false);
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

        {!isCodeSent ? (
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
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="min-h-14 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-lg outline-none transition placeholder:text-zinc-500 focus:border-red-400"
              placeholder="Confirm password"
              type="password"
              required
            />

            <button
              disabled={isLoading}
              className="min-h-16 rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700 active:scale-[0.98]"
              type="submit"
            >
              {isLoading ? "Sending code..." : "Send Verification Code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="mt-8 flex flex-col gap-4">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
              <p className="text-sm font-bold text-emerald-100">Code sent to</p>
              <p className="mt-1 break-all text-base text-emerald-50">{pendingEmail}</p>
            </div>

            <input
              value={otpCode}
              onChange={(event) => setOtpCode(event.target.value)}
              className="min-h-14 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-center text-2xl font-bold tracking-[0.35em] outline-none transition placeholder:text-zinc-500 focus:border-red-400"
              inputMode="numeric"
              placeholder="Code"
              required
            />

            <button
              disabled={isLoading}
              className="min-h-16 rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700 active:scale-[0.98]"
              type="submit"
            >
              {isLoading ? "Verifying..." : "Verify & Create Account"}
            </button>

            <button
              onClick={handleResendCode}
              disabled={isLoading || cooldown > 0}
              className="min-h-14 rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-base font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]"
              type="button"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Code"}
            </button>
          </form>
        )}

        <button
          onClick={handleGoogleSignup}
          disabled={isLoading}
          className="mt-4 min-h-16 w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-lg font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]"
          type="button"
        >
          Continue with Google
        </button>

        {successMessage ? (
          <p className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-100">
            {successMessage}
          </p>
        ) : null}

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
