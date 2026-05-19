"use client";

import { useParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { socket } from "../../lib/socket";

type Player = {
  id: string;
  name: string;
  isHost: boolean;
};

type RoomSession = {
  playerName: string;
  roomCode: string;
  isHost: boolean;
};

type RoomUpdate = {
  roomCode: string;
  players: Player[];
};

let pendingLeaveTimeout: number | null = null;

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const socketRef = useRef(socket);
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState("");
  const [socketId, setSocketId] = useState("");

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

  useEffect(() => {
    if (!session.playerName) {
      return;
    }

    const roomPath = `/room/${session.roomCode}`;
    const currentSocket = socketRef.current;

    if (pendingLeaveTimeout) {
      window.clearTimeout(pendingLeaveTimeout);
      pendingLeaveTimeout = null;
    }

    function handleRoomUpdated(room: RoomUpdate) {
      if (room.roomCode !== session.roomCode) {
        return;
      }

      const currentPlayer = room.players.find(
        (player) => player.id === currentSocket.id,
      );

      if (currentPlayer) {
        localStorage.setItem("isHost", String(currentPlayer.isHost));
      }

      setPlayers(room.players);
      setError("");
    }

    function handleErrorMessage(message: string) {
      setError(message);
    }

    function handleConnect() {
      setSocketId(currentSocket.id ?? "");
    }

    function emitLeaveRoomAndDisconnect(reason: string) {
      const leavePayload = {
        roomCode: session.roomCode,
        playerId: currentSocket.id,
        playerName: session.playerName,
      };

      console.log("leave-room", { ...leavePayload, reason });

      if (!currentSocket.connected) {
        return;
      }

      currentSocket.emit("leave-room", leavePayload, () => {
        currentSocket.disconnect();
      });

      window.setTimeout(() => {
        if (currentSocket.connected) {
          currentSocket.disconnect();
        }
      }, 200);
    }

    function scheduleLeaveRoomAndDisconnect() {
      if (pendingLeaveTimeout) {
        window.clearTimeout(pendingLeaveTimeout);
      }

      pendingLeaveTimeout = window.setTimeout(() => {
        pendingLeaveTimeout = null;

        if (window.location.pathname.toUpperCase() === roomPath.toUpperCase()) {
          console.log("leave-room skipped: still on room page", {
            roomCode: session.roomCode,
          });
          return;
        }

        emitLeaveRoomAndDisconnect("room-page-unmount");
      }, 150);
    }

    function handleBeforeUnload() {
      emitLeaveRoomAndDisconnect("beforeunload");
    }

    // Socket.io events keep this room page synced with the in-memory server room.
    currentSocket.on("connect", handleConnect);
    currentSocket.on("room-updated", handleRoomUpdated);
    currentSocket.on("error-message", handleErrorMessage);
    window.addEventListener("beforeunload", handleBeforeUnload);
    setSocketId(currentSocket.id ?? "");

    if (!currentSocket.connected) {
      currentSocket.connect();
    }

    // Socket.io join keeps the room page synced after navigation or refresh.
    currentSocket.emit("join-room", {
      playerName: session.playerName,
      roomCode: session.roomCode,
    });

    return () => {
      // Delay cleanup so React Strict Mode remounts do not delete an active room.
      scheduleLeaveRoomAndDisconnect();
      window.removeEventListener("beforeunload", handleBeforeUnload);
      currentSocket.off("connect", handleConnect);
      currentSocket.off("room-updated", handleRoomUpdated);
      currentSocket.off("error-message", handleErrorMessage);
    };
  }, [session.playerName, session.roomCode]);

  const currentPlayers =
    players.length > 0
      ? players
      : [
          {
            id: "local-player",
            name: session.playerName || "Unknown player",
            isHost: session.isHost,
          },
        ];
  const currentPlayer = currentPlayers.find((player) => player.id === socketId);
  const isCurrentHost = currentPlayer?.isHost ?? session.isHost;

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

          <div className="mt-4 flex flex-col gap-3">
            {currentPlayers.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between rounded-xl bg-zinc-950 px-4 py-3"
              >
                <span className="font-semibold">{player.name}</span>
                <span className="rounded-full bg-red-500/10 px-3 py-1 text-sm font-medium text-red-200">
                  {player.isHost ? "Host" : "Player"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {isCurrentHost ? (
          <button className="mt-8 min-h-16 w-full rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 active:scale-[0.98]">
            Start Game
          </button>
        ) : (
          <p className="mt-8 text-lg font-medium text-zinc-300">
            Waiting for host to start...
          </p>
        )}

        {error ? (
          <p className="mt-4 text-sm font-medium text-red-300">{error}</p>
        ) : null}
      </section>
    </main>
  );
}
