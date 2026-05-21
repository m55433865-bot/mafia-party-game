"use client";

import { useParams, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ensureMafiaProfile,
  isMafiaProfileComplete,
} from "../../lib/mafiaProfile";
import { socket } from "../../lib/socket";
import { supabase } from "../../lib/supabase";

type Player = {
  alive: boolean;
  avatarUrl: string;
  color: string;
  icon: string;
  id: string;
  name: string;
  isHost: boolean;
};

type RoomSession = {
  avatarUrl: string;
  playerName: string;
  roomCode: string;
  isHost: boolean;
};

type RoomUpdate = {
  allAlivePlayersVoted: boolean;
  confirmationResponses: string[];
  confirmationVoterIds: string[];
  defenseEndsAt: number;
  gameOver: boolean;
  gameStarted: boolean;
  lastEliminatedPlayerId: string;
  nightResultMessage: string;
  nightStep: string;
  pendingEliminationId: string;
  phase: string;
  playerColors: string[];
  playerIcons: string[];
  revealVoteCounts: boolean;
  roomCode: string;
  players: Player[];
  voteTargets: VoteTarget[];
  voteCounts: Record<string, number>;
  votingStatus: Record<string, boolean>;
  winner: string;
};

type GameStarted = {
  gameOver: boolean;
  phase: string;
  roomCode: string;
  role: string;
  players: Player[];
  voteCounts: Record<string, number>;
};

type DetectiveResult = {
  detectedParty: string;
  isMafia: boolean;
  targetName: string;
};

type VoteTarget = {
  targetPlayerId: string;
  voterId: string;
};

type RoleCard = {
  artClassName: string;
  description: string;
  imageLabel: string;
  title: string;
};

let pendingLeaveTimeout: number | null = null;

const fallbackPlayerColors = [
  "#f87171",
  "#fb923c",
  "#facc15",
  "#a3e635",
  "#34d399",
  "#2dd4bf",
  "#38bdf8",
  "#60a5fa",
  "#818cf8",
  "#a78bfa",
  "#c084fc",
  "#e879f9",
  "#f472b6",
  "#fb7185",
  "#f5f5f4",
];

function getRoleCard(role: string): RoleCard {
  if (role === "Mafia") {
    return {
      artClassName: "from-red-950 via-zinc-950 to-red-700",
      description: "Kill one player at night. Win by matching or outnumbering others.",
      imageLabel: "M",
      title: "Mafia",
    };
  }

  if (role === "Doctor") {
    return {
      artClassName: "from-emerald-950 via-zinc-950 to-emerald-600",
      description: "Save one player at night. Win with the villagers.",
      imageLabel: "D",
      title: "Doctor",
    };
  }

  if (role === "Detective") {
    return {
      artClassName: "from-sky-950 via-zinc-950 to-blue-600",
      description: "Investigate one player at night. Win with the villagers.",
      imageLabel: "I",
      title: "Detective",
    };
  }

  return {
    artClassName: "from-amber-950 via-zinc-950 to-yellow-600",
    description: "No night action. Find and eliminate all Mafia.",
    imageLabel: "V",
    title: "Villager",
  };
}

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const socketRef = useRef(socket);
  const previousAliveRef = useRef<Record<string, boolean> | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [allAlivePlayersVoted, setAllAlivePlayersVoted] = useState(false);
  const [authPlayerName, setAuthPlayerName] = useState("");
  const [authAvatarUrl, setAuthAvatarUrl] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [confirmationResponses, setConfirmationResponses] = useState<string[]>([]);
  const [confirmationVoterIds, setConfirmationVoterIds] = useState<string[]>([]);
  const [defenseEndsAt, setDefenseEndsAt] = useState(0);
  const [error, setError] = useState("");
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [phase, setPhase] = useState("lobby");
  const [role, setRole] = useState("");
  const [socketId, setSocketId] = useState("");
  const [lastEliminatedPlayerId, setLastEliminatedPlayerId] = useState("");
  const [nightResultMessage, setNightResultMessage] = useState("");
  const [nightStep, setNightStep] = useState("");
  const [nightSelectedTarget, setNightSelectedTarget] = useState("");
  const [pendingEliminationId, setPendingEliminationId] = useState("");
  const [detectiveResult, setDetectiveResult] = useState("");
  const [playerColors, setPlayerColors] = useState<string[]>([]);
  const [playerIcons, setPlayerIcons] = useState<string[]>([]);
  const [recentlyDeadIds, setRecentlyDeadIds] = useState<string[]>([]);
  const [revealVoteCounts, setRevealVoteCounts] = useState(false);
  const [roleCardVisible, setRoleCardVisible] = useState(true);
  const [voteTargets, setVoteTargets] = useState<VoteTarget[]>([]);
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({});
  const [votingStatus, setVotingStatus] = useState<Record<string, boolean>>({});
  const [selectedVote, setSelectedVote] = useState("");
  const [selectedConfirmationTarget, setSelectedConfirmationTarget] = useState("");
  const [timerNow, setTimerNow] = useState(0);
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [winner, setWinner] = useState("");

  const fallbackSession = JSON.stringify({
    avatarUrl: "",
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

      const savedPlayerName =
        sessionStorage.getItem("playerName") ??
        localStorage.getItem("playerName") ??
        "";
      const savedAvatarUrl = sessionStorage.getItem("avatarUrl") ?? "";
      const savedRoomCode =
        sessionStorage.getItem("roomCode") ??
        localStorage.getItem("roomCode") ??
        params.code;
      const savedIsHost =
        (sessionStorage.getItem("isHost") ?? localStorage.getItem("isHost")) ===
        "true";

      return JSON.stringify({
        avatarUrl: savedAvatarUrl,
        playerName: savedPlayerName,
        roomCode: savedRoomCode.toUpperCase(),
        isHost: savedIsHost,
      });
    },
    () => fallbackSession,
  );

  const session = useMemo<RoomSession>(
    () => {
      const savedSession = JSON.parse(sessionSnapshot) as RoomSession;

      return {
        ...savedSession,
        avatarUrl: savedSession.avatarUrl || authAvatarUrl,
        playerName: savedSession.playerName || authPlayerName,
      };
    },
    [authAvatarUrl, authPlayerName, sessionSnapshot],
  );

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

      const profile = await ensureMafiaProfile(user);

      if (!isMafiaProfileComplete(profile)) {
        router.replace("/profile");
        return;
      }

      if (!isMounted) {
        return;
      }

      const nextPlayerName = profile.display_name ?? "";
      const nextAvatarUrl = profile.avatar_url ?? "";
      sessionStorage.setItem("avatarUrl", nextAvatarUrl);
      sessionStorage.setItem("playerName", nextPlayerName);
      sessionStorage.setItem("roomCode", params.code.toUpperCase());
      setAuthAvatarUrl(nextAvatarUrl);
      setAuthPlayerName(nextPlayerName);
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
  }, [params.code, router]);

  useEffect(() => {
    if (isAuthLoading || !session.playerName) {
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
        sessionStorage.setItem("isHost", String(currentPlayer.isHost));
      }

      if (previousAliveRef.current) {
        const newlyDeadIds = room.players
          .filter(
            (player) =>
              previousAliveRef.current?.[player.id] === true && !player.alive,
          )
          .map((player) => player.id);

        if (newlyDeadIds.length > 0) {
          setRecentlyDeadIds(newlyDeadIds);
          window.setTimeout(() => setRecentlyDeadIds([]), 1200);
        }
      }

      previousAliveRef.current = Object.fromEntries(
        room.players.map((player) => [player.id, player.alive]),
      );

      setPlayers(room.players);
      setAllAlivePlayersVoted(room.allAlivePlayersVoted);
      setConfirmationResponses(room.confirmationResponses);
      setConfirmationVoterIds(room.confirmationVoterIds);
      setDefenseEndsAt(room.defenseEndsAt);
      setGameOver(room.gameOver);
      setGameStarted(room.gameStarted);
      setPhase(room.phase);
      setLastEliminatedPlayerId(room.lastEliminatedPlayerId);
      setNightResultMessage(room.nightResultMessage);
      setNightStep(room.nightStep);
      setPendingEliminationId(room.pendingEliminationId);
      setPlayerColors(room.playerColors);
      setPlayerIcons(room.playerIcons);
      setRevealVoteCounts(room.revealVoteCounts);
      setVoteTargets(room.voteTargets);
      setVoteCounts(room.voteCounts);
      setVotingStatus(room.votingStatus);
      setWinner(room.winner);

      if (!room.gameStarted || room.revealVoteCounts || !currentPlayer?.alive) {
        setSelectedVote("");
        setVoteSubmitted(false);
      }

      if (room.phase !== "confirmation") {
        setSelectedConfirmationTarget("");
      }

      if (room.phase === "day") {
        setNightSelectedTarget("");
        setDetectiveResult("");
      }

      if (!room.gameStarted) {
        setDetectiveResult("");
        setNightResultMessage("");
        setNightSelectedTarget("");
        setPendingEliminationId("");
        setRole("");
        setRoleCardVisible(true);
        setWinner("");
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

      setGameOver(game.gameOver);
      setGameStarted(true);
      setPhase(game.phase);
      setRole(game.role);
      setPlayers(game.players);
      setDetectiveResult("");
      setNightResultMessage("");
      setNightSelectedTarget("");
      setPendingEliminationId("");
      setRevealVoteCounts(false);
      setRoleCardVisible(true);
      setVoteCounts(game.voteCounts);
      setSelectedVote("");
      setVoteSubmitted(false);
      setError("");
    }

    function handleConnect() {
      setSocketId(currentSocket.id ?? "");
    }

    function handleDetectiveResult(result: DetectiveResult) {
      setDetectiveResult(
        `${result.targetName} (${result.detectedParty})`,
      );
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
    currentSocket.on("detective-result", handleDetectiveResult);
    currentSocket.on("error-message", handleErrorMessage);
    window.addEventListener("beforeunload", handleBeforeUnload);
    setSocketId(currentSocket.id ?? "");

    if (!currentSocket.connected) {
      currentSocket.connect();
    }

    // Socket.io join keeps the room page synced after navigation or refresh.
    currentSocket.emit("join-room", {
      avatarUrl: session.avatarUrl,
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
      currentSocket.off("detective-result", handleDetectiveResult);
      currentSocket.off("error-message", handleErrorMessage);
    };
  }, [isAuthLoading, session.avatarUrl, session.playerName, session.roomCode]);

  useEffect(() => {
    if (!defenseEndsAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setTimerNow(Date.now());
    }, 500);

    return () => window.clearInterval(timer);
  }, [defenseEndsAt]);

  const currentPlayers =
    players.length > 0
      ? players
      : [
          {
            alive: true,
            avatarUrl: session.avatarUrl,
            color: "#f5f5f4",
            icon: "🙂",
            id: "local-player",
            name: session.playerName || "Unknown player",
            isHost: session.isHost,
          },
        ];
  const currentPlayer = currentPlayers.find((player) => player.id === socketId);
  const isCurrentHost = currentPlayer?.isHost ?? session.isHost;
  const alivePlayers = currentPlayers.filter((player) => player.alive);
  const gamePlayers = currentPlayers.filter((player) => !player.isHost);
  const pendingEliminationPlayer = getPlayer(pendingEliminationId);
  const isConfirmationVoter = confirmationVoterIds.includes(socketId);
  const hasSubmittedConfirmation = confirmationResponses.includes(socketId);
  const allConfirmationVotesSubmitted =
    confirmationVoterIds.every((playerId) =>
      confirmationResponses.includes(playerId),
    );
  const defenseSecondsLeft = Math.max(
    0,
    timerNow ? Math.ceil((defenseEndsAt - timerNow) / 1000) : 30,
  );
  const usedColors = new Set(
    currentPlayers
      .filter((player) => player.id !== socketId)
      .map((player) => player.color),
  );
  const availablePlayerColors =
    playerColors.length > 0 ? playerColors : fallbackPlayerColors;
  const usedIcons = new Set(
    currentPlayers
      .filter((player) => player.id !== socketId)
      .map((player) => player.icon),
  );
  const currentPlayerHasProfilePhoto = Boolean(currentPlayer?.avatarUrl);
  const isCurrentPlayerAlive = currentPlayer?.isHost
    ? true
    : (currentPlayer?.alive ?? true);
  const canUseGameActions = gameStarted && !gameOver;
  const canVote =
    canUseGameActions &&
    phase === "day" &&
    !isCurrentHost &&
    Boolean(currentPlayer?.alive);
  const canModerateNight =
    canUseGameActions && phase === "night" && isCurrentHost && Boolean(nightStep);
  const phaseLabel =
    phase === "game-over"
      ? "Game Over"
      : phase === "confirmation"
        ? "Confirmation Vote"
      : phase === "defense"
        ? "Defense Phase"
      : phase === "day-results"
        ? "Voting Results"
      : phase === "day"
        ? "Day Phase"
        : phase === "night"
          ? "Night Phase"
          : "Lobby";
  const roleCard = getRoleCard(role);
  const nightStepText =
    nightStep === "Detective"
      ? "Detective wake up"
      : nightStep === "Mafia"
        ? "Mafia wake up"
        : nightStep === "Doctor"
          ? "Doctor wake up"
          : "Night is resolving";

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

  function handleDefenseDone() {
    setError("");
    socketRef.current.emit("defense-done", {
      roomCode: session.roomCode,
    });
  }

  function handleKeepVote() {
    setSelectedConfirmationTarget("");
    setError("");
    socketRef.current.emit("confirmation-vote", {
      choice: "keep",
      roomCode: session.roomCode,
    });
  }

  function handleChangeConfirmationVote(targetPlayerId: string) {
    setSelectedConfirmationTarget(targetPlayerId);
    setError("");
    socketRef.current.emit("confirmation-vote", {
      choice: "change",
      roomCode: session.roomCode,
      targetPlayerId,
    });
  }

  function handleFinishConfirmation() {
    setError("");
    socketRef.current.emit("finish-confirmation", {
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

  function handleReturnToLobby() {
    handleCancelGame();
  }

  function handleModeratorNightAction(targetPlayerId: string) {
    setNightSelectedTarget(targetPlayerId);
    setError("");
    socketRef.current.emit("moderator-night-action", {
      roomCode: session.roomCode,
      targetPlayerId,
    });
  }

  function handleMoveToNight() {
    setError("");
    socketRef.current.emit("move-to-night", {
      roomCode: session.roomCode,
    });
  }

  function handleChangeColor(color: string) {
    setError("");
    socketRef.current.emit("change-color", {
      color,
      roomCode: session.roomCode,
    });
  }

  function handleChangeIcon(icon: string) {
    setError("");
    socketRef.current.emit("change-icon", {
      icon,
      roomCode: session.roomCode,
    });
  }

  function handleLeaveLobby() {
    setError("");
    sessionStorage.removeItem("playerName");
    sessionStorage.removeItem("avatarUrl");
    sessionStorage.removeItem("roomCode");
    sessionStorage.removeItem("isHost");

    if (!socketRef.current.connected) {
      router.push("/");
      return;
    }

    socketRef.current.emit(
      "leave-room",
      {
        playerId: socketRef.current.id,
        playerName: session.playerName,
        roomCode: session.roomCode,
      },
      () => {
        socketRef.current.disconnect();
        router.push("/");
      },
    );
  }

  function getPlayer(playerId: string) {
    return currentPlayers.find((player) => player.id === playerId);
  }

  function renderPlayerName(player: Player | undefined, alignRight = false) {
    if (!player) {
      return <span className="font-semibold">Unknown player</span>;
    }

    return (
      <span
        className={`flex items-center gap-2 font-semibold ${
          alignRight ? "justify-end text-right" : ""
        }`}
        style={{ color: player.color }}
      >
        {player.avatarUrl ? (
          <span
            className={`relative h-7 w-7 shrink-0 ${
              !player.isHost && !player.alive ? "dead-icon-mark" : ""
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              className="h-full w-full rounded-full border border-white/10 object-cover"
              src={player.avatarUrl}
            />
          </span>
        ) : (
          <span
            className={`relative text-xl leading-none ${
              !player.isHost && !player.alive ? "dead-icon-mark" : ""
            }`}
          >
            {player.icon}
          </span>
        )}
        <span className={!player.isHost && !player.alive ? "line-through" : ""}>
          {player.name}
        </span>
      </span>
    );
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
      <section className="w-full max-w-sm text-center">
        <p className="text-sm font-medium uppercase tracking-[0.35em] text-red-300">
          Room Code
        </p>

        <h1 className="mt-4 text-6xl font-bold tracking-wider">
          {session.roomCode}
        </h1>

        {gameStarted ? (
          <div
            className={`mt-10 rounded-2xl border p-5 ${
              isCurrentPlayerAlive
                ? "border-emerald-500/20 bg-emerald-500/10"
                : "border-red-500/20 bg-red-500/10"
            }`}
          >
            <p
              className={`text-sm font-medium ${
                isCurrentPlayerAlive ? "text-emerald-200" : "text-red-200"
              }`}
            >
              {gameOver ? "Result" : "Your role"}
            </p>
            <p className="mt-2 text-4xl font-bold">
              {gameOver ? winner : role}
            </p>
            <p className="mt-4 text-lg font-medium text-zinc-200">
              Game has started
            </p>
            <p
              className={`mt-2 text-sm font-medium uppercase tracking-[0.3em] ${
                isCurrentPlayerAlive ? "text-emerald-200" : "text-red-200"
              }`}
            >
              {phaseLabel}
            </p>
            {lastEliminatedPlayerId ? (
              <p className="mt-4 text-sm font-medium text-zinc-300">
                {currentPlayers.find(
                  (player) => player.id === lastEliminatedPlayerId,
                )?.name ?? "A player"}{" "}
                was eliminated.
              </p>
            ) : null}
            {nightResultMessage ? (
              <p className="mt-4 text-sm font-medium text-zinc-300">
                {nightResultMessage}
              </p>
            ) : null}

            {!gameOver ? (
              <button
                onClick={() => setRoleCardVisible((visible) => !visible)}
                className="mt-5 min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 text-sm font-bold text-zinc-100 transition hover:border-zinc-500"
                type="button"
              >
                {roleCardVisible ? "Hide Role Card" : "Show Role Card"}
              </button>
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
            <p className="mt-3 text-sm font-medium text-zinc-400">
              {gamePlayers.length} {gamePlayers.length === 1 ? "player" : "players"}
            </p>

            <div className="mt-6">
              <p className="text-sm text-zinc-400">Name color</p>
              <div className="mt-3 grid grid-cols-5 gap-3">
                {availablePlayerColors.map((color) => {
                  const isTaken = usedColors.has(color);
                  const isSelected = currentPlayer?.color === color;

                  return (
                    <button
                      key={color}
                      onClick={() => handleChangeColor(color)}
                      disabled={isTaken}
                      aria-label={`Choose ${color}`}
                      className={`h-10 rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-25 ${
                        isSelected
                          ? "border-white ring-2 ring-white/30"
                          : "border-zinc-700"
                      }`}
                      style={{ backgroundColor: color }}
                      type="button"
                    />
                  );
                })}
              </div>
            </div>

            {playerIcons.length > 0 && !currentPlayerHasProfilePhoto ? (
              <div className="mt-6">
                <p className="text-sm text-zinc-400">Face icon</p>
                <div className="mt-3 grid grid-cols-5 gap-3">
                  {playerIcons.map((icon) => {
                    const isTaken = usedIcons.has(icon);
                    const isSelected = currentPlayer?.icon === icon;

                    return (
                      <button
                        key={icon}
                        onClick={() => handleChangeIcon(icon)}
                        disabled={isTaken}
                        aria-label={`Choose ${icon}`}
                        className={`flex h-11 items-center justify-center rounded-xl border bg-zinc-950 text-2xl transition disabled:cursor-not-allowed disabled:opacity-25 ${
                          isSelected
                            ? "border-white ring-2 ring-white/30"
                            : "border-zinc-700"
                        }`}
                        type="button"
                      >
                        {icon}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {gameStarted && !gameOver && !isCurrentHost && roleCardVisible ? (
          <div className="mt-5 overflow-hidden rounded-2xl border border-yellow-700/60 bg-zinc-950 p-3 shadow-2xl shadow-black/30">
            <div className="rounded-xl border border-yellow-500/50 bg-zinc-900 p-3">
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-950/20 px-3 py-2 text-center">
                <h2 className="text-xl font-black uppercase tracking-[0.18em] text-yellow-100">
                  {roleCard.title}
                </h2>
              </div>

              <div
                className={`mt-3 flex aspect-[4/3] items-center justify-center rounded-lg border border-yellow-500/30 bg-gradient-to-br ${roleCard.artClassName}`}
              >
                <div className="flex h-28 w-28 items-center justify-center rounded-full border border-yellow-200/40 bg-black/30 text-6xl font-black text-yellow-100 shadow-xl">
                  {roleCard.imageLabel}
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-yellow-500/30 bg-yellow-50 px-3 py-3 text-left text-zinc-950">
                <p className="text-sm font-bold leading-6">
                  {roleCard.description}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
          <h2 className="text-xl font-bold">Players</h2>

          <div className="mt-4 flex flex-col gap-3">
            {currentPlayers.map((player) => (
              <div
                key={player.id}
                className={`player-row flex items-center justify-between rounded-xl bg-zinc-950 px-4 py-3 ${
                  recentlyDeadIds.includes(player.id) && !player.isHost
                    ? "player-row-breaking"
                    : ""
                } ${!player.isHost && !player.alive ? "player-row-dead" : ""}`}
              >
                <span>
                  {renderPlayerName(player)}
                  {!player.isHost && !player.alive ? (
                    <span className="ml-2 text-sm text-zinc-500">(Dead)</span>
                  ) : null}
                </span>
                <div className="flex items-center gap-2">
                  {canUseGameActions &&
                  phase === "day" &&
                  player.alive &&
                  votingStatus[player.id] ? (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-zinc-950">
                      ✓
                    </span>
                  ) : null}
                  <span className="rounded-full bg-red-500/10 px-3 py-1 text-sm font-medium text-red-200">
                    {player.isHost ? "Host" : "Player"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {canUseGameActions && phase === "day" ? (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
            <h2 className="text-xl font-bold">Day Voting</h2>
            {currentPlayer?.alive ? (
              <p className="mt-1 text-sm text-zinc-400">
                Vote for one alive player.
              </p>
            ) : isCurrentHost ? (
              <p className="mt-1 text-sm text-zinc-400">
                Moderator waits for every player vote, then ends voting.
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
                      <span>
                        {renderPlayerName(player)}
                        {isSelf ? (
                          <span className="ml-2 text-sm text-zinc-500">You</span>
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

        {canUseGameActions && phase === "defense" ? (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
            <h2 className="text-xl font-bold">Defense Phase</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {pendingEliminationPlayer?.name ?? "The nominated player"} defends
              for 30 seconds in real life.
            </p>
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-4 text-center">
              {pendingEliminationPlayer ? (
                <div className="flex justify-center">
                  {renderPlayerName(pendingEliminationPlayer)}
                </div>
              ) : null}
              <button
                onClick={isCurrentHost ? handleDefenseDone : undefined}
                disabled={!isCurrentHost}
                className="mt-4 min-h-14 w-full rounded-xl bg-zinc-950 px-4 text-3xl font-black tabular-nums text-red-100 disabled:cursor-default"
                type="button"
              >
                00:{String(defenseSecondsLeft).padStart(2, "0")}
              </button>
            </div>
            {isCurrentHost ? (
              <button
                onClick={handleDefenseDone}
                className="mt-4 min-h-14 w-full rounded-xl bg-red-500 px-4 text-base font-bold text-white transition hover:bg-red-400 active:scale-[0.98]"
                type="button"
              >
                Defend Done
              </button>
            ) : (
              <p className="mt-4 text-sm text-zinc-400">
                Waiting for the moderator to finish the defense.
              </p>
            )}
          </div>
        ) : null}

        {canUseGameActions && phase === "confirmation" ? (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
            <h2 className="text-xl font-bold">Confirmation Vote</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Voters on {pendingEliminationPlayer?.name ?? "the nominee"} can keep
              the vote or change once.
            </p>

            {isConfirmationVoter && !hasSubmittedConfirmation ? (
              <div className="mt-4 flex flex-col gap-3">
                <button
                  onClick={handleKeepVote}
                  className="min-h-14 rounded-xl border border-zinc-700 bg-zinc-950 px-4 text-left font-bold text-zinc-100 transition hover:border-zinc-500"
                  type="button"
                >
                  Keep vote
                </button>
                {alivePlayers
                  .filter(
                    (player) =>
                      player.id !== socketId && player.id !== pendingEliminationId,
                  )
                  .map((player) => {
                    const isSelected = selectedConfirmationTarget === player.id;

                    return (
                      <button
                        key={player.id}
                        onClick={() => handleChangeConfirmationVote(player.id)}
                        className={`flex min-h-14 items-center justify-between rounded-xl border px-4 text-left transition ${
                          isSelected
                            ? "border-red-400 bg-red-500/10"
                            : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                        }`}
                        type="button"
                      >
                        {renderPlayerName(player)}
                        <span className="text-sm font-bold text-red-200">
                          Change
                        </span>
                      </button>
                    );
                  })}
              </div>
            ) : null}

            {isConfirmationVoter && hasSubmittedConfirmation ? (
              <p className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-center text-sm font-bold text-emerald-100">
                Confirmation submitted
              </p>
            ) : null}

            {!isCurrentHost && !isConfirmationVoter ? (
              <p className="mt-4 text-sm text-zinc-400">
                Waiting for the confirmation voters.
              </p>
            ) : null}

            {isCurrentHost ? (
              <>
                <button
                  onClick={handleFinishConfirmation}
                  disabled={!allConfirmationVotesSubmitted}
                  className="mt-4 min-h-14 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 text-base font-bold text-zinc-100 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-500"
                  type="button"
                >
                  Show Result
                </button>
                <p className="mt-3 text-sm text-zinc-400">
                  {allConfirmationVotesSubmitted
                    ? "Ready to show the result"
                    : "Waiting for confirmation votes..."}
                </p>
              </>
            ) : null}
          </div>
        ) : null}

        {gameStarted && revealVoteCounts ? (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
            <h2 className="text-xl font-bold">Vote Results</h2>
            <div className="mt-4 flex flex-col gap-3">
              {voteTargets.map((vote) => (
                <div
                  key={vote.voterId}
                  className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl bg-zinc-950 px-4 py-3"
                >
                  {renderPlayerName(getPlayer(vote.voterId))}
                  <span className="text-lg font-bold text-red-200">→</span>
                  {renderPlayerName(getPlayer(vote.targetPlayerId), true)}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {canUseGameActions && phase === "night" ? (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
            <h2 className="text-xl font-bold">Night Action</h2>

            {isCurrentHost ? (
              <>
                <p className="mt-1 text-lg font-bold text-zinc-100">
                  {nightStepText}
                </p>
                <p className="mt-1 text-sm text-zinc-400">
                  Pick the target after checking with the role in real life.
                </p>

                {canModerateNight ? (
                  <div className="mt-4 flex flex-col gap-3">
                    {alivePlayers.map((player) => {
                      const isSelected = nightSelectedTarget === player.id;

                      return (
                        <button
                          key={player.id}
                          onClick={() => handleModeratorNightAction(player.id)}
                          className={`flex min-h-14 items-center justify-between rounded-xl border px-4 text-left transition ${
                            isSelected
                              ? "border-red-400 bg-red-500/10"
                              : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                          }`}
                        >
                          {renderPlayerName(player)}
                          <span className="text-sm font-bold text-red-200">
                            {isSelected ? "Submitted" : "Pick"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : null}

            {!isCurrentHost && !currentPlayer?.alive ? (
              <p className="mt-1 text-sm text-zinc-400">
                Dead players wait during the night.
              </p>
            ) : null}

            {!isCurrentHost && currentPlayer?.alive ? (
              <p className="mt-1 text-sm text-zinc-400">
                Sleeping. Waiting for the moderator...
              </p>
            ) : null}

            {!isCurrentHost && detectiveResult ? (
              <p className="mt-4 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm font-bold text-zinc-100">
                {detectiveResult}
              </p>
            ) : null}
          </div>
        ) : null}

        {!gameStarted && isCurrentHost ? (
          <>
            <button
              onClick={handleStartGame}
              className="mt-8 min-h-16 w-full rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 active:scale-[0.98]"
            >
              Start Game
            </button>
          </>
        ) : null}

        {!gameStarted && !isCurrentHost ? (
          <p className="mt-8 text-lg font-medium text-zinc-300">
            Waiting for host to start...
          </p>
        ) : null}

        {!gameStarted ? (
          <button
            onClick={handleLeaveLobby}
            className="mt-4 min-h-14 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-6 text-base font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900 active:scale-[0.98]"
            type="button"
          >
            Leave Lobby
          </button>
        ) : null}

        {gameStarted && isCurrentHost ? (
          <div className="mt-8 flex flex-col gap-3">
            {!gameOver && phase === "day" ? (
              <>
                <button
                  onClick={handleEndVoting}
                  disabled={!allAlivePlayersVoted}
                  className="min-h-16 w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-lg font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-500 active:scale-[0.98]"
                >
                  End Voting
                </button>
                <p className="text-sm font-medium text-zinc-400">
                  {allAlivePlayersVoted
                    ? "All votes submitted"
                    : "Waiting for all alive players to vote..."}
                </p>
              </>
            ) : null}
            {!gameOver && phase === "day-results" ? (
              <button
                onClick={handleMoveToNight}
                className="min-h-16 w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-lg font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 active:scale-[0.98]"
              >
                Move to Night
              </button>
            ) : null}
            {gameOver ? (
              <button
                onClick={handleReturnToLobby}
                className="min-h-16 w-full rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 active:scale-[0.98]"
              >
                Return to Lobby
              </button>
            ) : (
              <button
                onClick={handleCancelGame}
                className="min-h-16 w-full rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 active:scale-[0.98]"
              >
                Cancel Game
              </button>
            )}
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 text-sm font-medium text-red-300">{error}</p>
        ) : null}
      </section>
    </main>
  );
}
