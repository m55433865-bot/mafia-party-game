"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MafiaProfile } from "./lib/mafiaProfile";
import {
  ensureMafiaProfile,
  isMafiaProfileComplete,
} from "./lib/mafiaProfile";
import { RoleImagePreloader } from "./components/RoleImagePreloader";
import { getStablePlayerId, socket } from "./lib/socket";
import { supabase } from "./lib/supabase";

export default function Home() {
  const router = useRouter();
  const [profile, setProfile] = useState<MafiaProfile | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  function enterRoom({
    avatarUrl,
    isHost,
    playerName,
    roomCode: nextRoomCode,
  }: {
    avatarUrl: string;
    isHost: boolean;
    playerName: string;
    roomCode: string;
  }) {
    if (!nextRoomCode) {
      throw new Error("The server did not return a room code.");
    }

    sessionStorage.setItem("playerName", playerName);
    sessionStorage.setItem("roomCode", nextRoomCode);
    sessionStorage.setItem("isHost", String(isHost));
    sessionStorage.setItem("avatarUrl", avatarUrl);
    setLoadingMessage("Opening room...");
    router.push(`/room/${nextRoomCode}`);
  }

  async function postRoomAction(
    path: string,
    payload: Record<string, string>,
  ) {
    const response = await fetch(path, {
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
    const result = (await response.json()) as {
      error?: string;
      isHost?: boolean;
      ok: boolean;
      roomCode?: string;
    };

    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "Room request failed.");
    }

    return result;
  }

  useEffect(() => {
    let isMounted = true;

    async function requireUserProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const mafiaProfile = await ensureMafiaProfile(user);

      if (!isMafiaProfileComplete(mafiaProfile)) {
        router.replace("/profile");
        return;
      }

      if (!isMounted) {
        return;
      }

      setProfile(mafiaProfile);
      setUserEmail(user.email ?? "");
      setIsAuthLoading(false);
    }

    requireUserProfile().catch(() => {
      if (!isMounted) {
        return;
      }

      setError("Could not load your account.");
      setIsAuthLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [router]);

  function getPlayerName() {
    return profile?.display_name?.trim() ?? "";
  }

  async function handleCreateRoom() {
    const playerName = getPlayerName();

    if (!playerName) {
      router.push("/profile");
      return;
    }

    try {
      const startedAt = performance.now();
      setError("");
      setIsLoading(true);
      setLoadingMessage("Creating room...");
      const payload = {
        avatarUrl: profile?.avatar_url ?? "",
        playerId: getStablePlayerId(),
        playerName,
      };

      const response = await postRoomAction("/api/create-room", payload);
      enterRoom({
        avatarUrl: payload.avatarUrl,
        isHost: response.isHost ?? true,
        playerName,
        roomCode: response.roomCode ?? "",
      });

      console.log("create-room completed over http", {
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not create the room.",
      );
      setIsLoading(false);
      setLoadingMessage("");
    }
  }

  async function handleJoinRoom() {
    const playerName = getPlayerName();
    const nextRoomCode = roomCode.trim().toUpperCase();

    if (!playerName) {
      router.push("/profile");
      return;
    }

    if (!nextRoomCode) {
      setError("Enter the room code.");
      return;
    }

    try {
      const startedAt = performance.now();
      setError("");
      setIsLoading(true);
      setLoadingMessage("Joining room...");
      const payload = {
        avatarUrl: profile?.avatar_url ?? "",
        playerId: getStablePlayerId(),
        playerName,
        roomCode: nextRoomCode,
      };

      const response = await postRoomAction("/api/join-room", payload);
      enterRoom({
        avatarUrl: payload.avatarUrl,
        isHost: response.isHost ?? false,
        playerName,
        roomCode: response.roomCode ?? nextRoomCode,
      });

      console.log("join-room completed over http", {
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not join the room.",
      );
      setIsLoading(false);
      setLoadingMessage("");
    }
  }

  async function handleLogout() {
    sessionStorage.clear();
    socket.disconnect();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (isAuthLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 py-10 text-white">
        <p className="text-sm font-medium text-zinc-400">Checking account...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 py-10 text-white">
      <RoleImagePreloader />
      <section className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="mb-8 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200">
          Browser party game
        </div>

        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
          Mafia Party Game
        </h1>

        <p className="mt-5 text-lg leading-8 text-zinc-300">
          Gather your friends at a coffee shop, open the game on your phones,
          and play Mafia together around the table.
        </p>

        <div className="mt-8 w-full rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-left">
          <p className="text-sm text-zinc-400">Signed in as</p>
          <div className="mt-3 flex items-center gap-3">
            {profile?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                className="h-12 w-12 rounded-xl object-cover"
                src={profile.avatar_url}
              />
            ) : null}
            <div>
              <p className="text-lg font-bold">{profile?.display_name}</p>
              <p className="text-sm text-zinc-500">{userEmail}</p>
            </div>
          </div>
          <button
            onClick={() => router.push("/profile")}
            className="mt-4 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 text-sm font-bold text-zinc-100 transition hover:border-zinc-500"
            type="button"
          >
            Edit Profile
          </button>
        </div>

        <div className="mt-6 flex w-full flex-col gap-4">
          <button
            onClick={handleCreateRoom}
            disabled={isLoading}
            className="min-h-16 rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700 active:scale-[0.98]"
          >
            {isLoading ? loadingMessage || "Connecting..." : "Create Room"}
          </button>

          <button
            onClick={() => router.push("/roles")}
            className="min-h-14 rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-base font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 active:scale-[0.98]"
            type="button"
          >
            View Roles
          </button>

          <div className="my-2 h-px bg-zinc-800" />

          <label className="text-left text-sm font-medium text-zinc-300">
            Room code
            <input
              value={roomCode}
              onChange={(event) => {
                setRoomCode(event.target.value.toUpperCase());
                setError("");
              }}
              className="mt-2 min-h-14 w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-center text-lg font-bold uppercase tracking-[0.3em] text-white outline-none transition placeholder:tracking-normal placeholder:text-zinc-500 focus:border-red-400"
              maxLength={6}
              placeholder="ABC123"
              type="text"
            />
          </label>

          <button
            onClick={handleJoinRoom}
            disabled={isLoading}
            className="min-h-16 rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-lg font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 active:scale-[0.98]"
          >
            Join Room
          </button>

          <button
            onClick={handleLogout}
            className="min-h-14 rounded-2xl border border-zinc-800 bg-zinc-950 px-6 text-base font-bold text-zinc-300 transition hover:border-zinc-600 hover:text-white"
            type="button"
          >
            Logout
          </button>

          {error ? (
            <p className="text-sm font-medium text-red-300">{error}</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
