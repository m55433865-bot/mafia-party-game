"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function generateRoomCode() {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";

  for (let i = 0; i < 6; i += 1) {
    code += characters[Math.floor(Math.random() * characters.length)];
  }

  return code;
}

export default function Home() {
  const router = useRouter();
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");

  function saveRoomSession(nextRoomCode: string, isHost: boolean) {
    localStorage.setItem("playerName", playerName.trim());
    localStorage.setItem("roomCode", nextRoomCode);
    localStorage.setItem("isHost", String(isHost));
  }

  function handleCreateRoom() {
    if (!playerName.trim()) {
      setError("Enter your name first.");
      return;
    }

    const nextRoomCode = generateRoomCode();
    saveRoomSession(nextRoomCode, true);
    router.push(`/room/${nextRoomCode}`);
  }

  function handleJoinRoom() {
    const nextRoomCode = roomCode.trim().toUpperCase();

    if (!playerName.trim() || !nextRoomCode) {
      setError("Enter your name and room code.");
      return;
    }

    saveRoomSession(nextRoomCode, false);
    router.push(`/room/${nextRoomCode}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 py-10 text-white">
      <section className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="mb-8 rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-200">
          Browser party game
        </div>

        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
          Mafia Party Game
        </h1>

        <p className="mt-5 text-lg leading-8 text-zinc-300">
          Gather your friends at a coffee shop, open the game on your phones,
          and play Mafia together around the table.
        </p>

        <div className="mt-10 flex w-full flex-col gap-4">
          <label className="text-left text-sm font-medium text-zinc-300">
            Player name
            <input
              value={playerName}
              onChange={(event) => {
                setPlayerName(event.target.value);
                setError("");
              }}
              className="mt-2 min-h-14 w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-lg text-white outline-none transition placeholder:text-zinc-500 focus:border-red-400"
              placeholder="Enter your name"
              type="text"
            />
          </label>

          <button
            onClick={handleCreateRoom}
            className="min-h-16 rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 active:scale-[0.98]"
          >
            Create Room
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
            className="min-h-16 rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-lg font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 active:scale-[0.98]"
          >
            Join Room
          </button>

          {error ? (
            <p className="text-sm font-medium text-red-300">{error}</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
