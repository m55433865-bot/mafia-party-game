"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MafiaProfile } from "./lib/mafiaProfile";
import {
  ensureMafiaProfile,
  isMafiaProfileComplete,
} from "./lib/mafiaProfile";
import { RoleImagePreloader } from "./components/RoleImagePreloader";
import { socket } from "./lib/socket";
import { supabase } from "./lib/supabase";

type Player = {
  id: string;
  name: string;
  isHost: boolean;
};

type RoomUpdate = {
  roomCode: string;
  players: Player[];
};

export default function Home() {
  const router = useRouter();
  const [profile, setProfile] = useState<MafiaProfile | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

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

  useEffect(() => {
    function handleRoomUpdated(room: RoomUpdate) {
      const currentPlayer = room.players.find((player) => player.id === socket.id);

      if (!currentPlayer) {
        return;
      }

      sessionStorage.setItem("playerName", currentPlayer.name);
      sessionStorage.setItem("roomCode", room.roomCode);
      sessionStorage.setItem("isHost", String(currentPlayer.isHost));
      sessionStorage.setItem("avatarUrl", profile?.avatar_url ?? "");
      router.push(`/room/${room.roomCode}`);
    }

    function handleErrorMessage(message: string) {
      setError(message);
      setIsLoading(false);
    }

    function handleConnectError() {
      setError("Could not connect to the game server.");
      setIsLoading(false);
    }

    // Socket.io events drive room creation and joining from the homepage.
    socket.on("room-updated", handleRoomUpdated);
    socket.on("error-message", handleErrorMessage);
    socket.on("connect_error", handleConnectError);

    return () => {
      socket.off("room-updated", handleRoomUpdated);
      socket.off("error-message", handleErrorMessage);
      socket.off("connect_error", handleConnectError);
    };
  }, [profile?.avatar_url, router]);

  function connectSocket() {
    if (!socket.connected) {
      socket.connect();
    }
  }

  function resetAndConnect() {
    setError("");
    setIsLoading(true);
    connectSocket();
  }

  function getPlayerName() {
    return profile?.display_name?.trim() ?? "";
  }

  function handleCreateRoom() {
    const playerName = getPlayerName();

    if (!playerName) {
      router.push("/profile");
      return;
    }

    resetAndConnect();
    socket.emit("create-room", {
      avatarUrl: profile?.avatar_url ?? "",
      playerName,
    });
  }

  function handleJoinRoom() {
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

    resetAndConnect();
    socket.emit("join-room", {
      avatarUrl: profile?.avatar_url ?? "",
      playerName,
      roomCode: nextRoomCode,
    });
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
            {isLoading ? "Connecting..." : "Create Room"}
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
