"use client";

import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
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
import { RoleImagePreloader } from "../../components/RoleImagePreloader";
import { getRoleCard } from "../../lib/roles";
import {
  getStablePlayerId,
  socket,
} from "../../lib/socket";
import { supabase } from "../../lib/supabase";

type Player = {
  alive: boolean;
  avatarUrl: string;
  color: string;
  connected: boolean;
  disconnectedAt: number;
  icon: string;
  id: string;
  isBot?: boolean;
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
  cupidLoverIds: string[];
  defenseEndsAt: number;
  gameOver: boolean;
  gameStarted: boolean;
  lastEliminatedPlayerId: string;
  nightResultMessage: string;
  nightStep: string;
  pendingEliminationId: string;
  phase: string;
  ownRole: string;
  playerColors: string[];
  playerIcons: string[];
  playerRoles: Record<string, string>;
  readyPlayerIds: string[];
  revealVoteCounts: boolean;
  roleOptions: string[];
  roomCode: string;
  players: Player[];
  selectedRoles: string[];
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

type VoteTarget = {
  targetPlayerId: string;
  voterId: string;
};

type SocketAck = {
  addedCount?: number;
  error?: string;
  ok: boolean;
  removedCount?: number;
};

type RoomActionResponse = {
  error?: string;
  ok: boolean;
  room?: RoomUpdate;
};

let pendingLeaveTimeout: number | null = null;
let isManualLeaveInProgress = false;

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

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const socketRef = useRef(socket);
  const previousAliveRef = useRef<Record<string, boolean> | null>(null);
  const restoreStartedAtRef = useRef(0);
  const localRoleDeckDirtyRef = useRef(false);
  const selectedRolesRef = useRef<string[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [allAlivePlayersVoted, setAllAlivePlayersVoted] = useState(false);
  const [authPlayerName, setAuthPlayerName] = useState("");
  const [authAvatarUrl, setAuthAvatarUrl] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [confirmationResponses, setConfirmationResponses] = useState<string[]>([]);
  const [confirmationVoterIds, setConfirmationVoterIds] = useState<string[]>([]);
  const [cupidLoverIds, setCupidLoverIds] = useState<string[]>([]);
  const [defenseEndsAt, setDefenseEndsAt] = useState(0);
  const [error, setError] = useState("");
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [phase, setPhase] = useState("lobby");
  const [role, setRole] = useState("");
  const [socketId, setSocketId] = useState(() => getStablePlayerId());
  const [lastEliminatedPlayerId, setLastEliminatedPlayerId] = useState("");
  const [nightResultMessage, setNightResultMessage] = useState("");
  const [pendingEliminationId, setPendingEliminationId] = useState("");
  const [playerColors, setPlayerColors] = useState<string[]>([]);
  const [playerIcons, setPlayerIcons] = useState<string[]>([]);
  const [playerRoles, setPlayerRoles] = useState<Record<string, string>>({});
  const [recentlyDeadIds, setRecentlyDeadIds] = useState<string[]>([]);
  const [revealVoteCounts, setRevealVoteCounts] = useState(false);
  const [roleCardVisible, setRoleCardVisible] = useState(true);
  const [selectedBotVoterId, setSelectedBotVoterId] = useState("");
  const [roleOptions, setRoleOptions] = useState<string[]>([
    "Detective",
    "Doctor",
    "Mafia",
    "Villager",
    "Vigilante",
    "Cupid",
    "Jester",
    "Mafia Jester",
  ]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [voteTargets, setVoteTargets] = useState<VoteTarget[]>([]);
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({});
  const [votingStatus, setVotingStatus] = useState<Record<string, boolean>>({});
  const [selectedVote, setSelectedVote] = useState("");
  const [selectedCupidLoverIds, setSelectedCupidLoverIds] = useState<string[]>([]);
  const [selectedConfirmationTarget, setSelectedConfirmationTarget] = useState("");
  const [timerNow, setTimerNow] = useState(0);
  const [moderatorTimerSeconds, setModeratorTimerSeconds] = useState(0);
  const [isModeratorTimerRunning, setIsModeratorTimerRunning] = useState(false);
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [winner, setWinner] = useState("");
  const [isRealtimeReady, setIsRealtimeReady] = useState(false);
  const [isRoomCodeCopied, setIsRoomCodeCopied] = useState(false);
  const stablePlayerId = useMemo(() => getStablePlayerId(), []);

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
    selectedRolesRef.current = selectedRoles;
  }, [selectedRoles]);

  const applyRoomUpdate = useCallback((room: RoomUpdate) => {
    if (room.roomCode !== session.roomCode) {
      return;
    }

    const currentPlayer = room.players.find(
      (player) => player.id === stablePlayerId,
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
    setCupidLoverIds(room.cupidLoverIds);
    setDefenseEndsAt(room.defenseEndsAt);
    setGameOver(room.gameOver);
    setGameStarted(room.gameStarted);
    setPhase(room.phase);
    if (room.ownRole) {
      setRole(room.ownRole);
    }
    setLastEliminatedPlayerId(room.lastEliminatedPlayerId);
    setNightResultMessage(room.nightResultMessage);
    setPendingEliminationId(room.pendingEliminationId);
    setPlayerColors(room.playerColors);
    setPlayerIcons(room.playerIcons);
    setPlayerRoles(room.playerRoles);
    setRevealVoteCounts(room.revealVoteCounts);
    setRoleOptions(room.roleOptions);
    if (!currentPlayer?.isHost || room.gameStarted) {
      localRoleDeckDirtyRef.current = false;
      setSelectedRoles(room.selectedRoles);
    } else if (
      localRoleDeckDirtyRef.current &&
      room.selectedRoles.join("|") === selectedRolesRef.current.join("|")
    ) {
      localRoleDeckDirtyRef.current = false;
    } else if (!localRoleDeckDirtyRef.current) {
      setSelectedRoles(room.selectedRoles);
    }
    setVoteTargets(room.voteTargets);
    setVoteCounts(room.voteCounts);
    setVotingStatus(room.votingStatus);
    setWinner(room.winner);

    if (!room.gameStarted || room.revealVoteCounts || !currentPlayer?.alive) {
      setSelectedVote("");
      setVoteSubmitted(false);
    }

    if (
      room.phase !== "confirmation" ||
      room.confirmationResponses.includes(stablePlayerId)
    ) {
      setSelectedConfirmationTarget("");
    }

    if (!room.gameStarted) {
      setIsModeratorTimerRunning(false);
      setNightResultMessage("");
      setPendingEliminationId("");
      setRole("");
      setRoleCardVisible(true);
      setModeratorTimerSeconds(0);
      setWinner("");
    }

    setError("");
  }, [session.roomCode, stablePlayerId]);

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
    isManualLeaveInProgress = false;

    if (pendingLeaveTimeout) {
      window.clearTimeout(pendingLeaveTimeout);
      pendingLeaveTimeout = null;
    }

    function handleRoomUpdated(room: RoomUpdate) {
      applyRoomUpdate(room);
      setIsRealtimeReady(true);
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
      setNightResultMessage("");
      setPendingEliminationId("");
      setRevealVoteCounts(false);
      setRoleCardVisible(true);
      setVoteCounts(game.voteCounts);
      setSelectedVote("");
      setVoteSubmitted(false);
      setError("");
    }

    function emitRoomRestore(trigger: string) {
      restoreStartedAtRef.current = performance.now();
      console.log("client room restore requested", {
        connected: currentSocket.connected,
        playerId: stablePlayerId,
        roomCode: session.roomCode,
        trigger,
      });

      currentSocket.emit("join-room", {
        avatarUrl: session.avatarUrl,
        playerId: stablePlayerId,
        playerName: session.playerName,
        restoreRequestedAt: Date.now(),
        roomCode: session.roomCode,
      });

      if (localRoleDeckDirtyRef.current && session.isHost) {
        currentSocket.emit("set-selected-roles", {
          roles: selectedRolesRef.current,
          roomCode: session.roomCode,
        });
      }
    }

    function connectNow(trigger: string) {
      if (currentSocket.connected) {
        emitRoomRestore(trigger);
        return;
      }

      console.log("socket connect requested", {
        active: currentSocket.active,
        playerId: stablePlayerId,
        roomCode: session.roomCode,
        trigger,
      });
      currentSocket.connect();
    }

    function handleConnect() {
      setSocketId(stablePlayerId);
      emitRoomRestore("connect");
    }

    function handleDisconnect(reason: string) {
      console.log("client socket disconnected", {
        connected: currentSocket.connected,
        playerId: stablePlayerId,
        reason,
        roomCode: session.roomCode,
      });
      setIsRealtimeReady(false);
    }

    function handleReconnectAttempt(attempt: number) {
      console.log("client reconnect attempt", {
        attempt,
        playerId: stablePlayerId,
        roomCode: session.roomCode,
      });
      setIsRealtimeReady(false);
    }

    function handleReconnectSuccess(attempt: number) {
      console.log("client reconnect success", {
        attempt,
        playerId: stablePlayerId,
        roomCode: session.roomCode,
      });
    }

    function handleReconnectFailure(error: Error) {
      console.log("client reconnect failure", {
        message: error.message,
        playerId: stablePlayerId,
        roomCode: session.roomCode,
      });
      setIsRealtimeReady(false);
    }

    function handleConnectError(error: Error) {
      console.log("client connect error", {
        message: error.message,
        playerId: stablePlayerId,
        roomCode: session.roomCode,
      });
      setIsRealtimeReady(false);
    }

    function handleSessionRestored(restoredSession: {
      phase: string;
      playerId: string;
      role: string;
      roomCode: string;
    }) {
      if (restoredSession.roomCode !== session.roomCode) {
        return;
      }

      console.log("client session restore", {
        ...restoredSession,
        elapsedMs: Math.round(performance.now() - restoreStartedAtRef.current),
      });
      setSocketId(restoredSession.playerId);
      setRole(restoredSession.role);
      setPhase(restoredSession.phase);
      setIsRealtimeReady(true);
    }

    function handleOnline() {
      connectNow("online");
    }

    function handlePageShow() {
      connectNow("pageshow");
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        connectNow("visible");
      }
    }

    function emitLeaveRoomAndDisconnect(reason: string) {
      const leavePayload = {
        roomCode: session.roomCode,
        playerId: stablePlayerId,
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
      if (isManualLeaveInProgress) {
        return;
      }

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

    // Socket.io events keep this room page synced with the in-memory server room.
    currentSocket.on("connect", handleConnect);
    currentSocket.on("disconnect", handleDisconnect);
    currentSocket.on("connect_error", handleConnectError);
    currentSocket.on("room-updated", handleRoomUpdated);
    currentSocket.on("game-started", handleGameStarted);
    currentSocket.on("session-restored", handleSessionRestored);
    currentSocket.on("error-message", handleErrorMessage);
    currentSocket.io.on("reconnect_attempt", handleReconnectAttempt);
    currentSocket.io.on("reconnect", handleReconnectSuccess);
    currentSocket.io.on("reconnect_error", handleReconnectFailure);
    window.addEventListener("online", handleOnline);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    connectNow("effect");

    return () => {
      // Delay cleanup so React Strict Mode remounts do not delete an active room.
      scheduleLeaveRoomAndDisconnect();
      currentSocket.off("connect", handleConnect);
      currentSocket.off("disconnect", handleDisconnect);
      currentSocket.off("connect_error", handleConnectError);
      currentSocket.off("room-updated", handleRoomUpdated);
      currentSocket.off("game-started", handleGameStarted);
      currentSocket.off("session-restored", handleSessionRestored);
      currentSocket.off("error-message", handleErrorMessage);
      currentSocket.io.off("reconnect_attempt", handleReconnectAttempt);
      currentSocket.io.off("reconnect", handleReconnectSuccess);
      currentSocket.io.off("reconnect_error", handleReconnectFailure);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    isAuthLoading,
    session.avatarUrl,
    session.isHost,
    session.playerName,
    session.roomCode,
    stablePlayerId,
    applyRoomUpdate,
  ]);

  useEffect(() => {
    if (isAuthLoading || !session.playerName || isRealtimeReady) {
      return;
    }

    let isMounted = true;

    async function refreshRoomState() {
      try {
        const response = await fetch(
          `/api/room-state?roomCode=${encodeURIComponent(
            session.roomCode,
          )}&playerId=${encodeURIComponent(stablePlayerId)}`,
        );
        const result = (await response.json()) as {
          error?: string;
          ok: boolean;
          room?: RoomUpdate;
        };

        if (!isMounted) {
          return;
        }

        if (!response.ok || !result.ok || !result.room) {
          setError(result.error ?? "Could not refresh room state.");
          return;
        }

        applyRoomUpdate(result.room);
      } catch {
        if (isMounted) {
          setError("Could not refresh room state.");
        }
      }
    }

    refreshRoomState();
    const interval = window.setInterval(refreshRoomState, 2500);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [
    isAuthLoading,
    isRealtimeReady,
    session.playerName,
    session.roomCode,
    stablePlayerId,
    applyRoomUpdate,
  ]);

  useEffect(() => {
    if (!defenseEndsAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setTimerNow(Date.now());
    }, 500);

    return () => window.clearInterval(timer);
  }, [defenseEndsAt]);

  useEffect(() => {
    if (!gameStarted || !isModeratorTimerRunning) {
      return;
    }

    const timer = window.setInterval(() => {
      setModeratorTimerSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [gameStarted, isModeratorTimerRunning]);

  const currentPlayers =
    players.length > 0
      ? players
      : [
          {
            alive: true,
            avatarUrl: session.avatarUrl,
            color: "#f5f5f4",
            connected: true,
            disconnectedAt: 0,
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
  const aliveBotPlayers = gamePlayers.filter(
    (player) => player.isBot && player.alive,
  );
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
  const roleCountMatchesPlayers = selectedRoles.length === gamePlayers.length;
  const canStartGame = isCurrentHost && roleCountMatchesPlayers;
  const assignedRoleEntries = gamePlayers.map((player) => ({
    player,
    role: playerRoles[player.id] ?? "Unknown",
  }));
  const mafiaTeamEntries = gamePlayers
    .filter((player) => {
      const playerRole = playerRoles[player.id];

      return playerRole === "Mafia" || playerRole === "Mafia Jester";
    })
    .map((player) => ({
      player,
      role: playerRoles[player.id],
    }));
  const cupidLoverEntries = cupidLoverIds
    .map((loverId) => getPlayer(loverId))
    .filter((player): player is Player => Boolean(player));
  const isCurrentPlayerCupidLover = cupidLoverIds.includes(socketId);
  const cupidIsInGame = Object.values(playerRoles).includes("Cupid");
  const isCurrentPlayerAlive = currentPlayer?.isHost
    ? true
    : (currentPlayer?.alive ?? true);
  const canUseGameActions = gameStarted && !gameOver;
  const canVote =
    canUseGameActions &&
    phase === "day" &&
    !isCurrentHost &&
    Boolean(currentPlayer?.alive);
  const phaseLabel =
    phase === "game-over"
      ? "Game Over"
    : phase === "simple-vote-results"
      ? "Voting Results"
      : phase === "simple"
        ? "Moderator Tools"
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

  async function postRoomAction(path: string, payload: Record<string, unknown>) {
    const response = await fetch(path, {
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
    const result = (await response.json()) as RoomActionResponse;

    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "Room request failed.");
    }

    if (result.room) {
      applyRoomUpdate(result.room);
    }

    return result;
  }

  async function handleStartGame() {
    console.log("start-game clicked", {
      connected: socketRef.current.connected,
      roomCode: session.roomCode,
    });

    setError("");

    try {
      await postRoomAction("/api/start-game", {
        playerId: socketId,
        roomCode: session.roomCode,
        selectedRoles,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not start game.");
    }
  }

  function handleAddSelectedRole(nextRole: string) {
    setError("");
    localRoleDeckDirtyRef.current = true;
    setSelectedRoles((currentRoles) => {
      const nextRoles = [...currentRoles, nextRole];
      selectedRolesRef.current = nextRoles;

      if (socketRef.current.connected) {
        socketRef.current.emit("set-selected-roles", {
          roles: nextRoles,
          roomCode: session.roomCode,
        });
      }

      return nextRoles;
    });
  }

  function handleRemoveSelectedRole(roleIndex: number) {
    setError("");
    localRoleDeckDirtyRef.current = true;
    setSelectedRoles((currentRoles) => {
      const nextRoles = currentRoles.filter((_, index) => index !== roleIndex);
      selectedRolesRef.current = nextRoles;

      if (socketRef.current.connected) {
        socketRef.current.emit("set-selected-roles", {
          roles: nextRoles,
          roomCode: session.roomCode,
        });
      }

      return nextRoles;
    });
  }

  async function handleAddBots(count: number) {
    setError("");

    try {
      await postRoomAction("/api/add-bots", {
        count,
        playerId: socketId,
        roomCode: session.roomCode,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not add bots.");
    }
  }

  async function handleClearBots() {
    setError("");
    setSelectedBotVoterId("");

    try {
      await postRoomAction("/api/clear-bots", {
        playerId: socketId,
        roomCode: session.roomCode,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not clear bots.");
    }
  }

  async function submitVoteFallback(targetPlayerId: string) {
    await postRoomAction("/api/vote-player", {
      playerId: socketId,
      roomCode: session.roomCode,
      targetPlayerId,
    });
  }

  function handleVote(targetPlayerId: string) {
    setSelectedVote(targetPlayerId);
    setVoteSubmitted(true);
    setError("");
    setVotingStatus((currentStatus) => ({
      ...currentStatus,
      [socketId]: true,
    }));

    if (!socketRef.current.connected) {
      submitVoteFallback(targetPlayerId).catch((error) => {
        setVoteSubmitted(false);
        setVotingStatus((currentStatus) => ({
          ...currentStatus,
          [socketId]: false,
        }));
        setError(error instanceof Error ? error.message : "Could not submit vote.");
      });
      return;
    }

    socketRef.current.timeout(1200).emit(
      "vote-player",
      {
        roomCode: session.roomCode,
        targetPlayerId,
      },
      (timeoutError: Error | null, response?: SocketAck) => {
        if (!timeoutError && response?.ok) {
          return;
        }

        submitVoteFallback(targetPlayerId).catch((error) => {
          setVoteSubmitted(false);
          setVotingStatus((currentStatus) => ({
            ...currentStatus,
            [socketId]: false,
          }));
          setError(
            response?.error ??
              (error instanceof Error ? error.message : "Could not submit vote."),
          );
        });
      },
    );
  }

  function handleBotVote(targetPlayerId: string) {
    if (!selectedBotVoterId) {
      setError("Choose a bot voter first.");
      return;
    }

    setError("");
    socketRef.current.timeout(5000).emit("moderator-bot-vote", {
      botPlayerId: selectedBotVoterId,
      playerId: socketId,
      roomCode: session.roomCode,
      targetPlayerId,
    }, (timeoutError: Error | null, response?: SocketAck) => {
      if (timeoutError) {
        setError("Bot vote request timed out. Restart or redeploy the server.");
        return;
      }

      if (!response?.ok) {
        setError(response?.error ?? "Could not submit bot vote.");
      }
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

  function handleOpenVoting() {
    setSelectedVote("");
    setVoteSubmitted(false);
    setError("");
    socketRef.current.emit("open-voting", {
      roomCode: session.roomCode,
    });
  }

  function handleRevealVotes() {
    setError("");
    socketRef.current.emit("reveal-votes", {
      roomCode: session.roomCode,
    });
  }

  function handleDeleteVoteResults() {
    setSelectedVote("");
    setVoteSubmitted(false);
    setError("");
    socketRef.current.emit("delete-vote-results", {
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

  async function handleModeratorKillPlayer(targetPlayerId: string) {
    setError("");

    try {
      await postRoomAction("/api/moderator-kill-player", {
        playerId: socketId,
        roomCode: session.roomCode,
        targetPlayerId,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not kill player.");
    }
  }

  function handleToggleCupidLover(playerId: string) {
    setError("");
    setSelectedCupidLoverIds((currentIds) => {
      if (currentIds.includes(playerId)) {
        return currentIds.filter((currentId) => currentId !== playerId);
      }

      return [...currentIds.slice(-1), playerId];
    });
  }

  async function handleSetCupidLovers() {
    setError("");

    try {
      await postRoomAction("/api/set-cupid-lovers", {
        loverIds: selectedCupidLoverIds,
        playerId: socketId,
        roomCode: session.roomCode,
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not set Cupid lovers.",
      );
    }
  }

  function handleToggleModeratorTimer() {
    if (!isModeratorTimerRunning) {
      setModeratorTimerSeconds(0);
    }

    setIsModeratorTimerRunning((running) => !running);
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
    isManualLeaveInProgress = true;
    sessionStorage.removeItem("playerName");
    sessionStorage.removeItem("avatarUrl");
    sessionStorage.removeItem("roomCode");
    sessionStorage.removeItem("isHost");

    if (!socketRef.current.connected) {
      socketRef.current.connect();
      socketRef.current.once("connect", () => {
        socketRef.current.emit(
          "leave-room",
          {
            playerId: stablePlayerId,
            playerName: session.playerName,
            roomCode: session.roomCode,
          },
          () => {
            socketRef.current.disconnect();
            router.push("/");
          },
        );
      });
      window.setTimeout(() => router.push("/"), 1200);
      return;
    }

    socketRef.current.emit(
      "leave-room",
      {
        playerId: stablePlayerId,
        playerName: session.playerName,
        roomCode: session.roomCode,
      },
      () => {
        socketRef.current.disconnect();
        router.push("/");
      },
    );
  }

  async function handleCopyRoomCode() {
    setError("");

    try {
      await navigator.clipboard.writeText(session.roomCode);
      setIsRoomCodeCopied(true);
      window.setTimeout(() => setIsRoomCodeCopied(false), 1400);
    } catch {
      setError("Could not copy the room code.");
    }
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
        style={{ color: !player.isHost && !player.alive ? "#71717a" : player.color }}
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
      <RoleImagePreloader />
      <section className="w-full max-w-sm text-center">
        <p className="text-sm font-medium uppercase tracking-[0.35em] text-red-300">
          Room Code
        </p>

        <button
          onClick={handleCopyRoomCode}
          className="mt-4 w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-4 transition hover:border-red-400 active:scale-[0.98]"
          type="button"
        >
          <span className="block text-6xl font-bold tracking-wider">
            {session.roomCode}
          </span>
          <span className="mt-2 block text-sm font-bold text-zinc-400">
            {isRoomCodeCopied ? "Copied" : "Tap to copy"}
          </span>
        </button>

        {isCurrentHost && !gameStarted ? (
          <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-left">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-emerald-100">
                  Test Bots
                </h2>
                <p className="mt-1 text-sm text-emerald-100/70">
                  Add fake players for testing.
                </p>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-bold text-emerald-100">
                Host
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[1, 3, 7].map((count) => (
                <button
                  key={count}
                  onClick={() => handleAddBots(count)}
                  className="min-h-14 rounded-xl bg-emerald-400 px-3 text-base font-black text-zinc-950 transition hover:bg-emerald-300 active:scale-[0.98]"
                  type="button"
                >
                  +{count}
                </button>
              ))}
            </div>
            <button
              onClick={handleClearBots}
              className="mt-3 min-h-12 w-full rounded-xl border border-emerald-400/30 bg-zinc-950 px-4 text-sm font-bold text-emerald-100 transition hover:border-emerald-300 active:scale-[0.98]"
              type="button"
            >
              Clear Bots
            </button>
          </div>
        ) : null}

        {isCurrentHost && gameStarted ? (
          <p className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-400">
            Bots can be added before the game starts. Return to lobby to change
            test players.
          </p>
        ) : null}

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

            {isCurrentHost ? (
              <div className="mt-6 border-t border-zinc-800 pt-6">
                  <p className="text-sm text-zinc-400">Add roles</p>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      {roleOptions.map((option) => {
                        const optionCard = getRoleCard(option);

                        return (
                          <button
                            key={option}
                            onClick={() => handleAddSelectedRole(option)}
                            className="min-h-12 rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm font-bold text-zinc-100 transition hover:border-zinc-500 active:scale-[0.98]"
                            type="button"
                          >
                            {optionCard.title}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-6">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-zinc-400">Role deck</p>
                        <p
                          className={`text-sm font-bold ${
                            roleCountMatchesPlayers
                              ? "text-emerald-300"
                              : "text-red-300"
                          }`}
                        >
                          {selectedRoles.length}/{gamePlayers.length}
                        </p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        {selectedRoles.length > 0 ? (
                          selectedRoles.map((selectedRole, roleIndex) => {
                            const selectedRoleCard = getRoleCard(selectedRole);

                            return (
                              <button
                                key={`${selectedRole}-${roleIndex}`}
                                onClick={() => handleRemoveSelectedRole(roleIndex)}
                                className="overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 text-left transition hover:border-red-400"
                                type="button"
                              >
                                <div
                                  className={`aspect-[4/3] overflow-hidden bg-gradient-to-br ${selectedRoleCard.artClassName}`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    alt=""
                                    className="h-full w-full object-cover"
                                    src={selectedRoleCard.imageSrc}
                                  />
                                </div>
                                <p className="px-3 py-2 text-sm font-bold">
                                  {selectedRoleCard.title}
                                </p>
                              </button>
                            );
                          })
                        ) : (
                          <p className="col-span-2 rounded-xl border border-dashed border-zinc-700 px-4 py-5 text-center text-sm text-zinc-500">
                            Tap roles above to build the deck.
                          </p>
                        )}
                      </div>
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
                className={`mt-3 aspect-[4/3] overflow-hidden rounded-lg border border-yellow-500/30 bg-gradient-to-br ${roleCard.artClassName}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  className="h-full w-full object-cover"
                  src={roleCard.imageSrc}
                />
              </div>

              <div className="mt-3 rounded-lg border border-yellow-500/30 bg-zinc-950 px-3 py-3 text-left text-yellow-50 shadow-inner shadow-black/60">
                <p className="text-sm font-black uppercase tracking-[0.12em] text-yellow-200">
                  Night ability
                </p>
                <p className="mt-1 text-sm font-bold leading-6 text-zinc-100">
                  {roleCard.nightAbility}
                </p>
                <p className="mt-3 text-sm font-black uppercase tracking-[0.12em] text-yellow-200">
                  Win condition
                </p>
                <p className="mt-1 text-sm font-bold leading-6 text-zinc-100">
                  {roleCard.winCondition}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {gameStarted && !isCurrentHost && mafiaTeamEntries.length > 1 ? (
          <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-left">
            <h2 className="text-xl font-bold text-red-100">Mafia Team</h2>
            <div className="mt-4 flex flex-col gap-3">
              {mafiaTeamEntries.map(({ player, role: mafiaRole }) => (
                <div
                  key={player.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950 px-4 py-3"
                >
                  {renderPlayerName(player)}
                  <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-sm font-bold text-red-100">
                    {mafiaRole}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {gameStarted && !isCurrentHost && isCurrentPlayerCupidLover ? (
          <div className="mt-5 rounded-2xl border border-pink-500/30 bg-pink-500/10 p-5 text-left">
            <h2 className="text-xl font-bold text-pink-100">Cupid Lovers</h2>
            <div className="mt-4 flex flex-col gap-3">
              {cupidLoverEntries.map((lover) => (
                <div
                  key={lover.id}
                  className="flex items-center justify-between rounded-xl bg-zinc-950 px-4 py-3"
                >
                  {renderPlayerName(lover)}
                  {lover.id === socketId ? (
                    <span className="rounded-full bg-pink-500/10 px-3 py-1 text-sm font-bold text-pink-100">
                      You
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {gameStarted && isCurrentHost ? (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
            <h2 className="text-xl font-bold">Moderator Timer</h2>
            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-5 text-center">
              <p className="text-5xl font-black tabular-nums text-emerald-200">
                {Math.floor(moderatorTimerSeconds / 60)}:
                {String(moderatorTimerSeconds % 60).padStart(2, "0")}
              </p>
              <button
                onClick={handleToggleModeratorTimer}
                className={`mt-4 min-h-14 w-full rounded-xl px-4 text-base font-bold transition active:scale-[0.98] ${
                  isModeratorTimerRunning
                    ? "bg-red-500 text-white hover:bg-red-400"
                    : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                }`}
                type="button"
              >
                {isModeratorTimerRunning ? "Stop Timer" : "Start Timer"}
              </button>
            </div>
          </div>
        ) : null}

        {gameStarted && isCurrentHost ? (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
            <h2 className="text-xl font-bold">Moderator Role View</h2>
            <div className="mt-4 flex flex-col gap-3">
              {assignedRoleEntries.map(({ player, role: assignedRole }) => {
                const assignedRoleCard = getRoleCard(assignedRole);

                return (
                  <div
                    key={player.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950 px-4 py-3"
                  >
                    {renderPlayerName(player)}
                    <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-sm font-bold text-yellow-100">
                      {assignedRoleCard.title}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {gameStarted && isCurrentHost ? (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
            <h2 className="text-xl font-bold">Cupid Lovers</h2>
            {cupidIsInGame ? (
              <>
                <div className="mt-4 flex flex-col gap-3">
                  {alivePlayers
                    .filter((player) => !player.isHost)
                    .map((player) => {
                      const isSelected = selectedCupidLoverIds.includes(player.id);
                      const isCurrentLover = cupidLoverIds.includes(player.id);

                      return (
                        <button
                          key={player.id}
                          onClick={() => handleToggleCupidLover(player.id)}
                          className={`flex min-h-14 items-center justify-between rounded-xl border px-4 text-left transition ${
                            isSelected
                              ? "border-pink-400 bg-pink-500/10"
                              : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                          }`}
                          type="button"
                        >
                          {renderPlayerName(player)}
                          <span className="text-sm font-bold text-pink-100">
                            {isCurrentLover ? "Lover" : isSelected ? "Selected" : "Pick"}
                          </span>
                        </button>
                      );
                    })}
                </div>
                <button
                  onClick={handleSetCupidLovers}
                  disabled={selectedCupidLoverIds.length !== 2}
                  className="mt-4 min-h-14 w-full rounded-xl bg-pink-500 px-4 text-base font-bold text-white transition hover:bg-pink-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
                  type="button"
                >
                  Submit Lovers
                </button>
                {cupidLoverIds.length === 2 ? (
                  <p className="mt-3 text-sm font-bold text-pink-100">
                    Lovers submitted
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-zinc-400">
                Cupid is not in this game.
              </p>
            )}
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
                    {player.isHost ? "Host" : player.isBot ? "Bot" : "Player"}
                  </span>
                  {gameStarted && isCurrentHost && !player.isHost ? (
                    <button
                      onClick={() => handleModeratorKillPlayer(player.id)}
                      disabled={!player.alive}
                      className={`min-h-8 rounded-full border px-3 text-xs font-bold transition ${
                        player.alive
                          ? "border-red-500/30 bg-red-500/10 text-red-100 hover:border-red-400"
                          : "cursor-not-allowed border-zinc-700 bg-zinc-900 text-zinc-500"
                      }`}
                      type="button"
                    >
                      {player.alive ? "Kill" : "Off"}
                    </button>
                  ) : null}
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

            {isCurrentHost && aliveBotPlayers.length > 0 ? (
              <div className="mt-5 border-t border-zinc-800 pt-5">
                <p className="text-sm font-bold text-zinc-200">Bot voting</p>
                <p className="mt-1 text-sm text-zinc-500">
                  Pick a bot, then choose who that bot votes for.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {aliveBotPlayers.map((botPlayer) => (
                    <button
                      key={botPlayer.id}
                      onClick={() => setSelectedBotVoterId(botPlayer.id)}
                      className={`min-h-12 rounded-xl border px-3 text-sm font-bold transition active:scale-[0.98] ${
                        selectedBotVoterId === botPlayer.id
                          ? "border-emerald-400 bg-emerald-500/10 text-emerald-100"
                          : "border-zinc-700 bg-zinc-950 text-zinc-100 hover:border-zinc-500"
                      }`}
                      type="button"
                    >
                      {botPlayer.name}
                      {votingStatus[botPlayer.id] ? " (Voted)" : ""}
                    </button>
                  ))}
                </div>
                {selectedBotVoterId ? (
                  <div className="mt-4 flex flex-col gap-3">
                    {alivePlayers
                      .filter((player) => player.id !== selectedBotVoterId)
                      .map((player) => (
                        <button
                          key={player.id}
                          onClick={() => handleBotVote(player.id)}
                          className={`flex min-h-14 items-center justify-between rounded-xl border px-4 text-left transition active:scale-[0.98] ${
                            voteTargets.some(
                              (vote) =>
                                vote.voterId === selectedBotVoterId &&
                                vote.targetPlayerId === player.id,
                            )
                              ? "border-red-400 bg-red-500/10"
                              : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                          }`}
                          type="button"
                        >
                          {renderPlayerName(player)}
                          <span className="text-sm font-bold text-red-200">
                            Vote
                          </span>
                        </button>
                      ))}
                  </div>
                ) : null}
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

        {gameStarted &&
        (revealVoteCounts ||
          phase === "simple-vote-results" ||
          (isCurrentHost && ["defense", "confirmation"].includes(phase))) ? (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left">
            <h2 className="text-xl font-bold">Vote Results</h2>
            {voteTargets.length > 0 ? (
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
            ) : (
              <p className="mt-3 text-sm text-zinc-400">
                Waiting for the moderator to reveal the vote results.
              </p>
            )}
          </div>
        ) : null}

        {!gameStarted && isCurrentHost ? (
          <>
            <button
              onClick={handleStartGame}
              disabled={!canStartGame}
              className="mt-8 min-h-16 w-full rounded-2xl bg-red-500 px-6 text-lg font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 active:scale-[0.98]"
            >
              Start Game
            </button>
            <p className="mt-3 text-sm font-medium text-zinc-400">
              {roleCountMatchesPlayers
                ? "Ready to start"
                : "Add one role for each player"}
            </p>
          </>
        ) : null}

        {!gameStarted && !isCurrentHost ? (
          <div className="mt-8">
            <p className="mt-3 text-lg font-medium text-zinc-300">
              Waiting for host to start...
            </p>
          </div>
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
            {!gameOver && phase === "simple" ? (
              <button
                onClick={handleOpenVoting}
                className="min-h-16 w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-lg font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 active:scale-[0.98]"
                type="button"
              >
                Open Voting
              </button>
            ) : null}
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
            {!gameOver &&
            phase === "simple-vote-results" ? (
              <>
                <button
                  onClick={handleRevealVotes}
                  disabled={revealVoteCounts}
                  className="min-h-16 w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-6 text-lg font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-500 active:scale-[0.98]"
                  type="button"
                >
                  {revealVoteCounts ? "Votes Revealed" : "Reveal Votes to Players"}
                </button>
                <button
                  onClick={handleDeleteVoteResults}
                  className="min-h-16 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-6 text-lg font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900 active:scale-[0.98]"
                  type="button"
                >
                  Delete Vote Results
                </button>
              </>
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
