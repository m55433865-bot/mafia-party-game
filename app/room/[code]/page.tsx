"use client";

import { useParams } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";

type RoomSession = {
  playerName: string;
  roomCode: string;
  isHost: boolean;
};

export default function RoomPage() {
  const params = useParams<{ code: string }>();

  const fallbackSession = JSON.stringify({
    playerName: "",
    roomCode: params.code.toUpperCase(),
    isHost: false,
  });

  const sessionSnapshot = useSyncExternalStore(
    () => () => {},
    () => {
      if (typeof window === "undefined") {
        return fallbackSession;
      }

      const savedPlayerName = localStorage.getItem("playerName") ?? "";
      const savedRoomCode = localStorage.getItem("roomCode") ?? params.code;
      const savedIsHost = localStorage.getItem("isHost") === "true";

      return JSON.stringify({
        playerName: savedPlayerName,
        roomCode: savedRoomCode.toUpperCase(),
        isHost: savedIsHost,
      });
    },
    () => fallbackSession,
  );

  const session = useMemo<RoomSession>(
    () => JSON.parse(sessionSnapshot) as RoomSession,
    [sessionSnapshot],
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 py-10 text-white">
      <section className="w-full max-w-sm text-center">
        <p className="text-sm font-medium uppercase tracking-[0.35em] text-red-300">
          Room Code
        </p>

        <h1 className="mt-4 text-6xl font-bold tracking-wider">
          {session.roomCode}
        </h1>

        <div className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
          <p className="text-sm text-zinc-400">Player name</p>
          <p className="mt-1 text-2xl font-bold">
            {session.playerName || "Unknown player"}
          </p>

          <p className="mt-6 text-sm text-zinc-400">Role</p>
          <p className="mt-1 text-2xl font-bold">
            {session.isHost ? "Host" : "Player"}
          </p>
        </div>

        <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
          <h2 className="text-xl font-bold">Players</h2>

          <div className="mt-4 flex items-center justify-between rounded-xl bg-zinc-950 px-4 py-3">
            <span className="font-semibold">
              {session.playerName || "Unknown player"}
            </span>
            <span className="rounded-full bg-red-500/10 px-3 py-1 text-sm font-medium text-red-200">
              {session.isHost ? "Host" : "Player"}
            </span>
          </div>
        </div>

        {session.isHost ? (
          <button className="mt-8 min-h-16 w-full rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 active:scale-[0.98]">
            Start Game
          </button>
        ) : (
          <p className="mt-8 text-lg font-medium text-zinc-300">
            Waiting for host to start...
          </p>
        )}
      </section>
    </main>
  );
}
