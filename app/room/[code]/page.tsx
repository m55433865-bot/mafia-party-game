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
  alive: boolean;
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
  gameStarted: boolean;
  lastEliminatedPlayerId: string;
  phase: string;
  revealVoteCounts: boolean;
  roomCode: string;
  players: Player[];
  voteCounts: Record<string, number>;
};

type GameStarted = {
  phase: string;
  roomCode: string;
  role: string;
  players: Player[];
  voteCounts: Record<string, number>;
};

let pendingLeaveTimeout: number | null = null;

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const socketRef = useRef(socket);
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState("");
  const [gameStarted, setGameStarted] = useState(false);
  const [phase, setPhase] = useState("lobby");
  const [role, setRole] = useState("");
  const [socketId, setSocketId] = useState("");
  const [lastEliminatedPlayerId, setLastEliminatedPlayerId] = useState("");
  const [revealVoteCounts, setRevealVoteCounts] = useState(false);
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({});
  const [selectedVote, setSelectedVote] = useState("");
  const [voteSubmitted, setVoteSubmitted] = useState(false);

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
      setGameStarted(room.gameStarted);
      setPhase(room.phase);
      setLastEliminatedPlayerId(room.lastEliminatedPlayerId);
      setRevealVoteCounts(room.revealVoteCounts);
      setVoteCounts(room.voteCounts);

      if (!room.gameStarted || room.revealVoteCounts || !currentPlayer?.alive) {
        setSelectedVote("");
        setVoteSubmitted(false);
      }

      if (!room.gameStarted) {
        setRole("");
      }

      setError("");
    }

    function handleErrorMessage(message: string) {
      setError(message);
    }

    function handleGameStarted(game: GameStarted) {
      if (game.roomCode !== session.roomCode) {
        return;
      }

      console.log("client received game-started", {
        roomCode: game.roomCode,
        role: game.role,
      });

      setGameStarted(true);
      setPhase(game.phase);
      setRole(game.role);
      setPlayers(game.players);
      setRevealVoteCounts(false);
      setVoteCounts(game.voteCounts);
      setSelectedVote("");
      setVoteSubmitted(false);
      setError("");
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
    currentSocket.on("game-started", handleGameStarted);
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
      currentSocket.off("game-started", handleGameStarted);
      currentSocket.off("error-message", handleErrorMessage);
    };
  }, [session.playerName, session.roomCode]);

  const currentPlayers =
    players.length > 0
      ? players
      : [
          {
            alive: true,
            id: "local-player",
            name: session.playerName || "Unknown player",
            isHost: session.isHost,
          },
        ];
  const currentPlayer = currentPlayers.find((player) => player.id === socketId);
  const isCurrentHost = currentPlayer?.isHost ?? session.isHost;
  const alivePlayers = currentPlayers.filter((player) => player.alive);
  const canVote = gameStarted && phase === "day" && Boolean(currentPlayer?.alive);

  function handleStartGame() {
    console.log("start-game clicked", {
      connected: socketRef.current.connected,
      roomCode: session.roomCode,
    });

    setError("");

    if (!socketRef.current.connected) {
      socketRef.current.connect();
      socketRef.current.once("connect", () => {
        socketRef.current.emit("start-game", {
          roomCode: session.roomCode,
        });
      });
      return;
    }

    socketRef.current.emit("start-game", {
      roomCode: session.roomCode,
    });
  }

  function handleVote(targetPlayerId: string) {
    setSelectedVote(targetPlayerId);
    setVoteSubmitted(true);
    setError("");
    socketRef.current.emit("vote-player", {
      roomCode: session.roomCode,
      targetPlayerId,
    });
  }

  function handleEndVoting() {
    setSelectedVote("");
    setVoteSubmitted(false);
    setError("");
    socketRef.current.emit("end-voting", {
      roomCode: session.roomCode,
    });
  }

  function handleCancelGame() {
    setSelectedVote("");
    setVoteSubmitted(false);
    setError("");
    socketRef.current.emit("cancel-game", {
      roomCode: session.roomCode,
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 py-10 text-white">
      <section className="w-full max-w-sm text-center">
        <p className="text-sm font-medium uppercase tracking-[0.35em] text-red-300">
          Room Code
        </p>

        <h1 className="mt-4 text-6xl font-bold tracking-wider">
          {session.roomCode}
        </h1>

        {gameStarted ? (
          <div className="mt-10 rounded-2xl border border-red-500/20 bg-red-500/10 p-5">
            <p className="text-sm font-medium text-red-200">Your role</p>
            <p className="mt-2 text-4xl font-bold">{role}</p>
            <p className="mt-4 text-lg font-medium text-zinc-200">
              Game has started
            </p>
            <p className="mt-2 text-sm font-medium uppercase tracking-[0.3em] text-red-200">
              {phase}
            </p>
            {lastEliminatedPlayerId ? (
              <p className="mt-4 text-sm font-medium text-zinc-300">
                {currentPlayers.find(
                  (player) => player.id === lastEliminatedPlayerId,
                )?.name ?? "A player"}{" "}
                was eliminated.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
            <p className="text-sm text-zinc-400">Player name</p>
            <p className="mt-1 text-2xl font-bold">
              {session.playerName || "Unknown player"}
            </p>

            <p className="mt-6 text-sm text-zinc-400">Lobby role</p>
            <p className="mt-1 text-2xl font-bold">
              {isCurrentHost ? "Host" : "Player"}
            </p>
          </div>
        )}

        <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
          <h2 className="text-xl font-bold">Players</h2>

          <div className="mt-4 flex flex-col gap-3">
            {currentPlayers.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between rounded-xl bg-zinc-950 px-4 py-3"
              >
                <span className="font-semibold">
                  {player.name}
                  {!player.alive ? (
                    <span className="ml-2 text-sm text-zinc-500">(Dead)</span>
                  ) : null}
                </span>
                <span className="rounded-full bg-red-500/10 px-3 py-1 text-sm font-medium text-red-200">
                  {player.isHost ? "Host" : "Player"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {gameStarted ? (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
            <h2 className="text-xl font-bold">Day Voting</h2>
            {currentPlayer?.alive ? (
              <p className="mt-1 text-sm text-zinc-400">
                Vote for one alive player.
              </p>
            ) : (
              <p className="mt-1 text-sm text-zinc-400">
                Dead players cannot vote.
              </p>
            )}

            {voteSubmitted && !revealVoteCounts ? (
              <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-center text-sm font-bold text-red-100">
                Vote submitted
              </p>
            ) : null}

            {currentPlayer?.alive ? (
              <div className="mt-4 flex flex-col gap-3">
                {alivePlayers.map((player) => {
                  const isSelf = player.id === socketId;
                  const isSelected = selectedVote === player.id;
                  const votes = voteCounts[player.id] ?? 0;
                  const voteLabel = revealVoteCounts
                    ? `${votes} votes`
                    : isSelected
                      ? "Voted"
                      : "Vote";

                  return (
                    <button
                      key={player.id}
                      onClick={() => handleVote(player.id)}
                      disabled={!canVote || isSelf}
                      className={`flex min-h-14 items-center justify-between rounded-xl border px-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        isSelected && !revealVoteCounts
                          ? "border-red-400 bg-red-500/10"
                          : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                      }`}
                    >
                      <span className="font-semibold">
                        {player.name}
                        {isSelf ? (
                          <span className="ml-2 text-sm text-zinc-500">
                            You
                          </span>
                        ) : null}
                      </span>
                      <span className="text-sm font-bold text-red-200">
                        {voteLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {!gameStarted && isCurrentHost ? (
          <>
            <button
              onClick={handleStartGame}
              disabled={currentPlayers.length < 4}
              className="mt-8 min-h-16 w-full rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 active:scale-[0.98]"
            >
              Start Game
            </button>
            {currentPlayers.length < 4 ? (
              <p className="mt-3 text-sm font-medium text-zinc-400">
                Need at least 4 players to start.
              </p>
            ) : null}
          </>
        ) : null}

        {!gameStarted && !isCurrentHost ? (
          <p className="mt-8 text-lg font-medium text-zinc-300">
            Waiting for host to start...
          </p>
        ) : null}

        {gameStarted && isCurrentHost ? (
          <div className="mt-8 flex flex-col gap-3">
            <button
              onClick={handleEndVoting}
              className="min-h-16 w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-lg font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 active:scale-[0.98]"
            >
              End Voting
            </button>
            <button
              onClick={handleCancelGame}
              className="min-h-16 w-full rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 active:scale-[0.98]"
            >
              Cancel Game
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 text-sm font-medium text-red-300">{error}</p>
        ) : null}
      </section>
    </main>
  );
}
