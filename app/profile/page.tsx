"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  ensureMafiaProfile,
  isMafiaProfileComplete,
  saveMafiaProfile,
} from "../lib/mafiaProfile";
import { supabase } from "../lib/supabase";

export default function ProfilePage() {
  const router = useRouter();
  const [avatarUrl, setAvatarUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [userId, setUserId] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const profile = await ensureMafiaProfile(user);

      if (!isMounted) {
        return;
      }

      setUserId(user.id);
      setDisplayName(profile.display_name ?? "");
      setAvatarUrl(profile.avatar_url ?? "");
      setIsLoading(false);

      if (isMafiaProfileComplete(profile)) {
        return;
      }
    }

    loadProfile().catch(() => {
      if (!isMounted) {
        return;
      }

      setError("Could not load your profile.");
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [router]);

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!displayName.trim() || !avatarUrl.trim()) {
      setError("Add your username and photo.");
      return;
    }

    setIsSaving(true);

    try {
      await saveMafiaProfile({
        avatarUrl,
        displayName,
        userId,
      });
      router.push("/");
    } catch {
      setError("Could not save your profile.");
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 py-10 text-white">
        <p className="text-sm font-medium text-zinc-400">Loading profile...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 py-10 text-white">
      <section className="w-full max-w-sm">
        <p className="text-sm font-medium uppercase tracking-[0.35em] text-emerald-300">
          Player Profile
        </p>
        <h1 className="mt-4 text-4xl font-bold">Set Your Game Identity</h1>

        <form onSubmit={handleSaveProfile} className="mt-8 flex flex-col gap-4">
          <label className="text-left text-sm font-medium text-zinc-300">
            Username
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-2 min-h-14 w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-lg text-white outline-none transition placeholder:text-zinc-500 focus:border-red-400"
              placeholder="Your Mafia name"
              type="text"
              required
            />
          </label>

          <label className="text-left text-sm font-medium text-zinc-300">
            Photo URL
            <input
              value={avatarUrl}
              onChange={(event) => setAvatarUrl(event.target.value)}
              className="mt-2 min-h-14 w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-lg text-white outline-none transition placeholder:text-zinc-500 focus:border-red-400"
              placeholder="https://example.com/photo.jpg"
              type="url"
              required
            />
          </label>

          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Profile preview"
              className="h-24 w-24 rounded-2xl border border-zinc-800 object-cover"
              src={avatarUrl}
            />
          ) : null}

          <button
            disabled={isSaving}
            className="min-h-16 rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700 active:scale-[0.98]"
            type="submit"
          >
            {isSaving ? "Saving..." : "Continue"}
          </button>

          {error ? (
            <p className="text-sm font-medium text-red-300">{error}</p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
