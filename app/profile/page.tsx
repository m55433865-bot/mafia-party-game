"use client";

import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
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
  const displayInitial = displayName.trim().slice(0, 1).toUpperCase() || "?";

  function resizePhoto(file: File) {
    return new Promise<string>((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);

      image.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 480;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);

        const context = canvas.getContext("2d");

        if (!context) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("Could not process image."));
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Choose a valid image."));
      };

      image.src = objectUrl;
    });
  }

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

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }

    setError("");

    try {
      const nextAvatarUrl = await resizePhoto(file);
      setAvatarUrl(nextAvatarUrl);
    } catch {
      setError("Could not load that photo.");
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

        <form onSubmit={handleSaveProfile} className="mt-8 flex flex-col gap-5">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-center">
            <div className="mx-auto flex h-32 w-32 items-center justify-center overflow-hidden rounded-3xl border border-zinc-700 bg-zinc-950">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="Profile preview"
                  className="h-full w-full object-cover"
                  src={avatarUrl}
                />
              ) : (
                <span className="text-5xl font-black text-zinc-600">
                  {displayInitial}
                </span>
              )}
            </div>

            <label className="mt-4 flex min-h-14 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-emerald-500/40 bg-emerald-500/10 px-4 text-base font-bold text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-500/15">
              Choose Photo
              <input
                accept="image/*"
                className="sr-only"
                onChange={handlePhotoChange}
                type="file"
              />
            </label>
          </div>

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
