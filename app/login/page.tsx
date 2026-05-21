"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ensureMafiaProfile, isMafiaProfileComplete } from "../lib/mafiaProfile";
import { supabase } from "../lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [successMessage, setSuccessMessage] = useState("");
  const [showOtpStep, setShowOtpStep] = useState(false);

  async function sendOtp(nextEmail: string) {
    const normalizedEmail = nextEmail.trim().toLowerCase();

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: true },
    });

    console.log("OTP sent with type: email", { email: normalizedEmail });

    if (otpError) {
      throw otpError;
    }

    return normalizedEmail;
  }

  async function handleSendOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    setIsLoading(true);

    try {
      const normalizedEmail = await sendOtp(email);
      setPendingEmail(normalizedEmail);
      setShowOtpStep(true);
      setSuccessMessage("Check your email and enter the verification code.");
      setResendCooldown(60);
    } catch (otpError) {
      setError(
        otpError instanceof Error ? otpError.message : "Could not send the code.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    const normalizedEmail = pendingEmail.trim().toLowerCase();
    const cleanOtpCode = otpCode.replace(/\s/g, "").trim();

    console.log("OTP verifying with type: email", { email: normalizedEmail });

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: cleanOtpCode,
      type: "email",
    });

    if (verifyError || !data.user) {
      console.error("Supabase OTP verification error", verifyError);
      setError(
        verifyError
          ? [
              `message: ${verifyError.message}`,
              `status: ${"status" in verifyError ? verifyError.status : "n/a"}`,
              `name: ${verifyError.name ?? "n/a"}`,
            ].join(" | ")
          : "No user returned from OTP verification.",
      );
      setIsLoading(false);
      return;
    }

    try {
      const profile = await ensureMafiaProfile(data.user);
      router.push(isMafiaProfileComplete(profile) ? "/" : "/profile");
    } catch {
      setError("Could not load your game profile.");
      setIsLoading(false);
    }
  }

  async function handleResendCode() {
    if (resendCooldown > 0 || !pendingEmail) {
      return;
    }

    setError("");
    setSuccessMessage("");
    setIsLoading(true);

    try {
      await sendOtp(pendingEmail);
      setSuccessMessage("A new verification code was sent.");
      setResendCooldown(60);
    } catch {
      setError("Could not resend the code. Try again in a moment.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (resendCooldown <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setResendCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  async function handleGoogleLogin() {
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
        <h1 className="mt-4 text-4xl font-bold">
          {showOtpStep ? "Verify Email" : "Log in"}
        </h1>

        {showOtpStep ? (
          <form onSubmit={handleVerifyOtp} className="mt-8 flex flex-col gap-4">
            <p className="text-sm leading-6 text-zinc-400">
              Enter the verification code sent to{" "}
              <span className="font-bold text-zinc-200">{pendingEmail}</span>.
            </p>
            <input
              value={otpCode}
              onChange={(event) => {
                setOtpCode(event.target.value.replace(/\s/g, "").replace(/\D/g, ""));
                setError("");
              }}
              className="min-h-16 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-center text-2xl font-black tracking-[0.4em] outline-none transition placeholder:tracking-normal placeholder:text-zinc-500 focus:border-red-400"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              type="text"
              required
            />

            <button
              disabled={isLoading || otpCode.trim().length < 6}
              className="min-h-16 rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700 active:scale-[0.98]"
              type="submit"
            >
              {isLoading ? "Checking..." : "Verify Code"}
            </button>

            <button
              onClick={handleResendCode}
              disabled={isLoading || resendCooldown > 0}
              className="min-h-14 rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-base font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              type="button"
            >
              {resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : "Resend code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSendOtp} className="mt-8 flex flex-col gap-4">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="min-h-14 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-lg outline-none transition placeholder:text-zinc-500 focus:border-red-400"
              placeholder="Email"
              type="email"
              required
            />

            <button
              disabled={isLoading}
              className="min-h-16 rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700 active:scale-[0.98]"
              type="submit"
            >
              {isLoading ? "Sending code..." : "Send Code"}
            </button>
          </form>
        )}

        {!showOtpStep ? (
          <button
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="mt-4 min-h-16 w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-lg font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]"
            type="button"
          >
            Continue with Google
          </button>
        ) : null}

        {successMessage ? (
          <p className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-100">
            {successMessage}
          </p>
        ) : null}

        {error ? <p className="mt-4 text-sm font-medium text-red-300">{error}</p> : null}

        <p className="mt-6 text-center text-sm text-zinc-400">
          Need an account?{" "}
          <Link className="font-bold text-emerald-200" href="/signup">
            Sign up
          </Link>
        </p>
      </section>
    </main>
  );
}
