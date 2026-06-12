"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MafiaProfile } from "./lib/mafiaProfile";
import {
  ensureMafiaProfile,
  isMafiaProfileComplete,
} from "./lib/mafiaProfile";
import { RoleImagePreloader } from "./components/RoleImagePreloader";
import {
  getStablePlayerId,
  setStablePlayerId,
  socket,
} from "./lib/socket";
import { supabase } from "./lib/supabase";

type ActiveRoom = {
  avatarUrl: string;
  connected: boolean;
  gameStarted: boolean;
  isHost: boolean;
  phase: string;
  playerName: string;
  roomCode: string;
};

export default function Home() {
  const router = useRouter();
  const [profile, setProfile] = useState<MafiaProfile | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [activeRoom, setActiveRoom] = useState<ActiveRoom | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isActiveRoomLoading, setIsActiveRoomLoading] = useState(true);
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

  async function getActiveRoom() {
    const response = await fetch(
      `/api/active-room?playerId=${encodeURIComponent(getStablePlayerId())}`,
      {
        cache: "no-store",
      },
    );
    const result = (await response.json()) as {
      activeRoom?: ActiveRoom | null;
      error?: string;
      ok: boolean;
    };

    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "Could not check your active room.");
    }

    return result.activeRoom ?? null;
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

      setStablePlayerId(user.id);
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
      try {
        setActiveRoom(await getActiveRoom());
      } catch (activeRoomError) {
        console.error("Could not check active room", activeRoomError);
        setActiveRoom(null);
      }
      setIsActiveRoomLoading(false);
      setIsAuthLoading(false);
    }

    requireUserProfile().catch(() => {
      if (!isMounted) {
        return;
      }

      setError("Could not load your account.");
      setIsActiveRoomLoading(false);
      setIsAuthLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }

    let isMounted = true;

    async function refreshActiveRoom() {
      try {
        const nextActiveRoom = await getActiveRoom();

        if (isMounted) {
          setActiveRoom(nextActiveRoom);
          setIsActiveRoomLoading(false);
        }
      } catch (activeRoomError) {
        console.error("Could not refresh active room", activeRoomError);
      }
    }

    function handlePageShow() {
      void refreshActiveRoom();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshActiveRoom();
      }
    }

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isAuthLoading]);

  function getPlayerName() {
    return profile?.display_name?.trim() ?? "";
  }

  async function handleReconnect() {
    if (!activeRoom) {
      return;
    }

    try {
      setError("");
      setIsLoading(true);
      setLoadingMessage("Restoring game...");
      const currentActiveRoom = await getActiveRoom();

      if (!currentActiveRoom) {
        setActiveRoom(null);
        throw new Error("This room is no longer active.");
      }

      enterRoom({
        avatarUrl: currentActiveRoom.avatarUrl || profile?.avatar_url || "",
        isHost: currentActiveRoom.isHost,
        playerName: currentActiveRoom.playerName || getPlayerName(),
        roomCode: currentActiveRoom.roomCode,
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not restore the room.",
      );
      setIsLoading(false);
      setLoadingMessage("");
    }
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
          {!isActiveRoomLoading && activeRoom ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-left">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-emerald-200">
                    Active {activeRoom.gameStarted ? "game" : "lobby"}
                  </p>
                  <p className="mt-1 text-2xl font-black">
                    Room {activeRoom.roomCode}
                  </p>
                  <p className="mt-1 text-sm text-zinc-300">
                    {activeRoom.isHost ? "Moderator" : "Player"} ·{" "}
                    {activeRoom.playerName}
                  </p>
                </div>
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-100">
                  Rejoin
                </span>
              </div>
              <button
                onClick={handleReconnect}
                disabled={isLoading}
                className="mt-4 min-h-14 w-full rounded-xl bg-emerald-400 px-5 text-base font-black text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 active:scale-[0.98]"
                type="button"
              >
                {isLoading && loadingMessage === "Restoring game..."
                  ? loadingMessage
                  : "Reconnect"}
              </button>
            </div>
          ) : null}

          <button
            onClick={handleCreateRoom}
            disabled={isLoading || Boolean(activeRoom)}
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
                setRoomCode(event.target.value.replace(/\D/g, ""));
                setError("");
              }}
              className="mt-2 min-h-14 w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-center text-3xl font-bold tracking-[0.2em] text-white outline-none transition placeholder:tracking-normal placeholder:text-zinc-500 focus:border-red-400"
              inputMode="numeric"
              maxLength={2}
              placeholder="12"
              type="text"
            />
          </label>

          <button
            onClick={handleJoinRoom}
            disabled={isLoading || Boolean(activeRoom)}
            className="min-h-16 rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-lg font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 active:scale-[0.98]"
          >
            Join Room
          </button>

          {activeRoom ? (
            <p className="text-sm text-zinc-400">
              Reconnect and use Leave Lobby before creating or joining another room.
            </p>
          ) : null}

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
