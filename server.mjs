import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? (dev ? "localhost" : "0.0.0.0");
const port = Number(process.env.PORT) || 3000;
const RECONNECT_GRACE_MS = 2 * 60 * 1000;
const ALLOWED_SOCKET_ORIGINS = new Set(
  [
    "https://mafia.yourteck.com",
    "https://www.mafia.yourteck.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.SOCKET_CORS_ORIGIN,
  ].filter(Boolean),
);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const PLAYER_COLORS = [
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

const PLAYER_ICONS = [
  "🕵️",
  "🎩",
  "🧔",
  "👨‍⚕️",
  "👩‍⚕️",
  "🧑‍💼",
  "👨‍💼",
  "👩‍💼",
  "🧑‍🎤",
  "🧛",
  "🥷",
  "👮",
  "🧙",
  "🧓",
  "👨‍🍳",
];

const BOT_NAMES = [
  "Nero",
  "Salem",
  "Vito",
  "Raven",
  "Mira",
  "Dante",
  "Silas",
  "Ivy",
  "Knox",
  "Luna",
  "Gio",
  "Rosa",
  "Enzo",
  "Nova",
  "Ash",
  "Vale",
  "Cleo",
  "Marco",
  "Nyx",
  "Zara",
];

const ROLE_OPTIONS = [
  "Detective",
  "Doctor",
  "Mafia",
  "Villager",
  "Vigilante",
  "Cupid",
  "Jester",
  "Mafia Jester",
];

function isMafiaRole(role) {
  return role === "Mafia" || role === "Mafia Jester";
}

function getSocketPlayerId(socket) {
  return String(socket.data.playerId ?? socket.id);
}

function isDetectiveMafiaResult(role) {
  return isMafiaRole(role) || role === "Jester";
}

function generateRoomCode() {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";

  for (let i = 0; i < 6; i += 1) {
    code += characters[Math.floor(Math.random() * characters.length)];
  }

  return code;
}

function createUniqueRoomCode(rooms) {
  let code = generateRoomCode();

  while (rooms.has(code)) {
    code = generateRoomCode();
  }

  return code;
}

function getUsedColors(room, ignoredPlayerId = "") {
  return new Set(
    Array.from(room.players.values())
      .filter((player) => player.id !== ignoredPlayerId)
      .map((player) => player.color),
  );
}

function getRandomAvailableColor(room) {
  const usedColors = getUsedColors(room);
  const availableColors = PLAYER_COLORS.filter((color) => !usedColors.has(color));

  if (availableColors.length === 0) {
    return "";
  }

  return availableColors[Math.floor(Math.random() * availableColors.length)];
}

function getUsedIcons(room, ignoredPlayerId = "") {
  return new Set(
    Array.from(room.players.values())
      .filter((player) => player.id !== ignoredPlayerId)
      .map((player) => player.icon),
  );
}

function getRandomAvailableIcon(room) {
  const usedIcons = getUsedIcons(room);
  const availableIcons = PLAYER_ICONS.filter((icon) => !usedIcons.has(icon));

  if (availableIcons.length === 0) {
    return "";
  }

  return availableIcons[Math.floor(Math.random() * availableIcons.length)];
}

function createBotPlayer(room, botNumber) {
  const color = getRandomAvailableColor(room);
  const icon = getRandomAvailableIcon(room);
  const usedNames = new Set(
    Array.from(room.players.values()).map((player) => player.name),
  );
  const availableNames = BOT_NAMES.filter((name) => !usedNames.has(name));
  const baseName =
    availableNames.length > 0
      ? availableNames[Math.floor(Math.random() * availableNames.length)]
      : `Bot ${botNumber}`;

  if (!color || !icon) {
    return null;
  }

  return {
    alive: true,
    avatarUrl: "",
    color,
    connected: true,
    disconnectedAt: 0,
    icon,
    id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    isBot: true,
    isHost: false,
    name: baseName,
    reconnectTimeout: null,
    socketId: "",
  };
}

function createEmptyRoom(hostId) {
  return {
    confirmationResponses: new Set(),
    confirmationChangedVoters: new Set(),
    cupidLoverIds: [],
    defenseEndsAt: 0,
    gameOver: false,
    gameStarted: false,
    hostId,
    lastEliminatedPlayerId: "",
    lastVoteCounts: {},
    lastVoteTargets: [],
    nightActions: {
      detectiveTargetId: "",
      doctorTargetId: "",
      mafiaTargetId: "",
    },
    nightResultMessage: "",
    nightStep: "",
    pendingEliminationId: "",
    phase: "lobby",
    players: new Map(),
    readyPlayerIds: new Set(),
    revealVoteCounts: false,
    roles: new Map(),
    selectedRoles: [],
    votes: new Map(),
    winner: "",
  };
}

function addHostToNewRoom(room, { avatarUrl, playerId, playerName, socketId = "" }) {
  const player = {
    alive: false,
    avatarUrl,
    color: getRandomAvailableColor(room),
    connected: Boolean(socketId),
    disconnectedAt: socketId ? 0 : Date.now(),
    icon: avatarUrl ? "" : getRandomAvailableIcon(room),
    id: playerId,
    name: playerName,
    isHost: true,
    reconnectTimeout: null,
    socketId,
  };

  if (!player.color || (!player.avatarUrl && !player.icon)) {
    return { error: "Room is full." };
  }

  room.players.set(playerId, player);
  return { player };
}

function addPlayerToRoom(room, { avatarUrl, playerId, playerName, socketId = "" }) {
  const player = {
    alive: true,
    avatarUrl,
    color: getRandomAvailableColor(room),
    connected: Boolean(socketId),
    disconnectedAt: socketId ? 0 : Date.now(),
    icon: avatarUrl ? "" : getRandomAvailableIcon(room),
    id: playerId,
    name: playerName,
    isHost: room.hostId === playerId,
    reconnectTimeout: null,
    socketId,
  };

  if (!player.color || (!player.avatarUrl && !player.icon)) {
    return { error: "Room is full." };
  }

  room.players.set(playerId, player);
  return { player };
}

function getGamePlayers(room) {
  return Array.from(room.players.values()).filter((player) => !player.isHost);
}

function getAliveGamePlayers(room) {
  return getGamePlayers(room).filter((player) => player.alive);
}

function getAlivePlayersByRole(room, roleName) {
  return getAliveGamePlayers(room).filter(
    (player) => room.roles.get(player.id) === roleName,
  );
}

function getAliveMafiaPlayers(room) {
  return getAliveGamePlayers(room).filter((player) =>
    isMafiaRole(room.roles.get(player.id)),
  );
}

function getNextNightStep(room) {
  if (getAlivePlayersByRole(room, "Detective").length > 0) {
    return "Detective";
  }

  if (getAliveMafiaPlayers(room).length > 0) {
    return "Mafia";
  }

  if (getAlivePlayersByRole(room, "Doctor").length > 0) {
    return "Doctor";
  }

  return "";
}

function formatRoom(roomCode, room, viewerId = "") {
  const votingStatus = {};
  const alivePlayers = getAliveGamePlayers(room);
  const confirmationVoterIds = getConfirmationVoterIds(room);
  const canSeeVoteResults =
    room.revealVoteCounts ||
    (["defense", "confirmation", "simple-vote-results"].includes(room.phase) &&
      viewerId === room.hostId);
  const viewerRole = room.roles.get(viewerId);
  const canSeeMafiaRoles = isMafiaRole(viewerRole);
  const canSeeCupidLovers =
    viewerId === room.hostId || room.cupidLoverIds.includes(viewerId);

  for (const player of alivePlayers) {
    votingStatus[player.id] = room.votes.has(player.id);
  }

  const publicPlayers = Array.from(room.players.values()).map((player) => ({
    alive: player.alive,
    avatarUrl: player.avatarUrl,
    color: player.color,
    connected: player.connected,
    disconnectedAt: player.disconnectedAt,
    icon: player.icon,
    id: player.id,
    isBot: Boolean(player.isBot),
    isHost: player.isHost,
    name: player.name,
  }));

  return {
    allAlivePlayersVoted:
      alivePlayers.length > 0 &&
      alivePlayers.every((player) => room.votes.has(player.id)),
    confirmationResponses: Array.from(room.confirmationResponses),
    confirmationVoterIds,
    cupidLoverIds: canSeeCupidLovers ? room.cupidLoverIds : [],
    defenseEndsAt: room.defenseEndsAt,
    gameStarted: room.gameStarted,
    gameOver: room.gameOver,
    lastEliminatedPlayerId: room.lastEliminatedPlayerId,
    nightResultMessage: room.nightResultMessage,
    pendingEliminationId: room.pendingEliminationId,
    phase: room.phase,
    nightStep: room.nightStep,
    playerColors: PLAYER_COLORS,
    playerIcons: PLAYER_ICONS,
    readyPlayerIds: Array.from(room.readyPlayerIds),
    revealVoteCounts: room.revealVoteCounts,
    roleOptions: ROLE_OPTIONS,
    roomCode,
    players: publicPlayers,
    ownRole:
      viewerId === room.hostId
        ? "Moderator"
        : viewerRole ?? "",
    playerRoles:
      viewerId === room.hostId
        ? Object.fromEntries(room.roles.entries())
        : canSeeMafiaRoles
          ? Object.fromEntries(
              Array.from(room.roles.entries()).filter(([, role]) =>
                isMafiaRole(role),
              ),
            )
        : {},
    selectedRoles: room.selectedRoles,
    voteTargets: canSeeVoteResults ? room.lastVoteTargets : [],
    voteCounts: canSeeVoteResults ? room.lastVoteCounts : {},
    votingStatus,
    winner: room.winner,
  };
}

function emitRoomUpdated(io, roomCode, room) {
  let sentCount = 0;

  for (const player of room.players.values()) {
    if (player.connected && player.socketId) {
      io.to(player.socketId).emit("room-updated", formatRoom(roomCode, room, player.id));
      sentCount += 1;
    }
  }

  console.log("room-updated emit", {
    connectedPlayers: sentCount,
    phase: room.phase,
    playerCount: room.players.size,
    roomCode,
  });
}

function getVoteDetails(room) {
  const voteCounts = {};
  const voteTargets = [];

  for (const [voterId, targetPlayerId] of room.votes.entries()) {
    const voter = room.players.get(voterId);
    const targetPlayer = room.players.get(targetPlayerId);

    if (!voter?.alive || voter.isHost || !targetPlayer?.alive || targetPlayer.isHost) {
      continue;
    }

    voteCounts[targetPlayerId] = (voteCounts[targetPlayerId] ?? 0) + 1;
    voteTargets.push({ targetPlayerId, voterId });
  }

  return { voteCounts, voteTargets };
}

function getHighestVotedPlayerId(voteCounts) {
  let highestVotedPlayerId = "";
  let highestVotes = 0;

  for (const [playerId, voteCount] of Object.entries(voteCounts)) {
    if (voteCount > highestVotes) {
      highestVotedPlayerId = playerId;
      highestVotes = voteCount;
    }
  }

  return highestVotes > 0 ? highestVotedPlayerId : "";
}

function getConfirmationVoterIds(room) {
  if (!room.pendingEliminationId) {
    return [];
  }

  return Array.from(room.votes.entries())
    .filter(([voterId, targetPlayerId]) => {
      const voter = room.players.get(voterId);

      return (
        targetPlayerId === room.pendingEliminationId &&
        voter?.alive &&
        !voter.isHost &&
        !room.confirmationChangedVoters.has(voterId)
      );
    })
    .map(([voterId]) => voterId);
}

function setVoteSnapshot(room) {
  const { voteCounts, voteTargets } = getVoteDetails(room);

  room.lastVoteCounts = voteCounts;
  room.lastVoteTargets = voteTargets;
  return voteCounts;
}

function startDefensePhase(room, nomineeId) {
  room.confirmationResponses = new Set();
  room.defenseEndsAt = Date.now() + 30000;
  room.pendingEliminationId = nomineeId;
  room.phase = "defense";
  room.revealVoteCounts = false;
}

function shufflePlayers(players) {
  const shuffledPlayers = [...players];

  for (let i = shuffledPlayers.length - 1; i > 0; i -= 1) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [shuffledPlayers[i], shuffledPlayers[randomIndex]] = [
      shuffledPlayers[randomIndex],
      shuffledPlayers[i],
    ];
  }

  return shuffledPlayers;
}

function assignSelectedRoles(players, selectedRoles) {
  const shuffledPlayers = shufflePlayers(players);
  const shuffledRoles = shufflePlayers(selectedRoles);
  const roles = new Map();

  shuffledPlayers.forEach((player, index) => {
    roles.set(player.id, shuffledRoles[index] ?? "Villager");
  });

  return roles;
}

function cleanSelectedRoles(roles) {
  if (!Array.isArray(roles)) {
    return [];
  }

  return roles
    .map((role) => String(role ?? "").trim())
    .filter((role) => ROLE_OPTIONS.includes(role));
}

function emitGameStarted(io, roomCode, room) {
  const publicPlayers = formatRoom(roomCode, room).players;
  let sentCount = 0;

  for (const player of room.players.values()) {
    if (!player.connected || !player.socketId) {
      continue;
    }

    io.to(player.socketId).emit("game-started", {
      phase: room.phase,
      gameOver: room.gameOver,
      roomCode,
      role: player.isHost ? "Moderator" : room.roles.get(player.id),
      players: publicPlayers,
      voteCounts: {},
      revealVoteCounts: false,
      nightStep: room.nightStep,
    });
    sentCount += 1;
  }

  console.log("start-game emit", {
    connectedPlayers: sentCount,
    playerCount: room.players.size,
    roomCode,
  });

  emitRoomUpdated(io, roomCode, room);
}

function resetDayVotes(room) {
  if (room.gameOver) {
    return;
  }

  room.phase = "day";
  room.confirmationResponses = new Set();
  room.defenseEndsAt = 0;
  room.lastVoteTargets = [];
  room.nightActions = {
    detectiveTargetId: "",
    doctorTargetId: "",
    mafiaTargetId: "",
  };
  room.nightStep = "";
  room.pendingEliminationId = "";
  room.votes = new Map();
  room.revealVoteCounts = false;
}

function startNightPhase(room) {
  if (room.gameOver) {
    return;
  }

  room.phase = "night";
  room.confirmationResponses = new Set();
  room.confirmationChangedVoters = new Set();
  room.defenseEndsAt = 0;
  room.pendingEliminationId = "";
  room.revealVoteCounts = false;
  room.nightActions = {
    detectiveTargetId: "",
    doctorTargetId: "",
    mafiaTargetId: "",
  };
  room.nightStep = getNextNightStep(room);
  room.nightResultMessage = "";
  room.votes = new Map();
}

function resetRoomToLobby(room) {
  room.gameOver = false;
  room.gameStarted = false;
  room.confirmationResponses = new Set();
  room.confirmationChangedVoters = new Set();
  room.cupidLoverIds = [];
  room.defenseEndsAt = 0;
  room.lastEliminatedPlayerId = "";
  room.lastVoteCounts = {};
  room.lastVoteTargets = [];
  room.nightActions = {
    detectiveTargetId: "",
    doctorTargetId: "",
    mafiaTargetId: "",
  };
  room.nightResultMessage = "";
  room.nightStep = "";
  room.pendingEliminationId = "";
  room.phase = "lobby";
  room.readyPlayerIds = new Set();
  room.revealVoteCounts = false;
  room.roles = new Map();
  room.votes = new Map();
  room.winner = "";

  for (const player of room.players.values()) {
    player.alive = !player.isHost;
  }
}

function checkWinCondition(room) {
  if (!room.gameStarted || room.gameOver) {
    return false;
  }

  let aliveMafiaCount = 0;
  let aliveNonMafiaCount = 0;

  for (const player of getAliveGamePlayers(room)) {
    const role = room.roles.get(player.id);

    if (isMafiaRole(role)) {
      aliveMafiaCount += 1;
    } else {
      aliveNonMafiaCount += 1;
    }
  }

  if (aliveMafiaCount === 0) {
    room.gameOver = true;
    room.phase = "game-over";
    room.winner = "Villagers Win";
    room.votes = new Map();
    room.nightActions = {
      detectiveTargetId: "",
      doctorTargetId: "",
      mafiaTargetId: "",
    };
    return true;
  }

  if (aliveMafiaCount >= aliveNonMafiaCount) {
    room.gameOver = true;
    room.phase = "game-over";
    room.winner = "Mafia Wins";
    room.votes = new Map();
    room.nightActions = {
      detectiveTargetId: "",
      doctorTargetId: "",
      mafiaTargetId: "",
    };
    return true;
  }

  return false;
}

function findPlayerId(socket, room, playerId, playerName) {
  if (playerId && room.players.has(playerId)) {
    return playerId;
  }

  if (room.players.has(socket.id)) {
    return socket.id;
  }

  const socketPlayerId = getSocketPlayerId(socket);

  if (room.players.has(socketPlayerId)) {
    return socketPlayerId;
  }

  for (const [savedPlayerId, player] of room.players.entries()) {
    if (playerName && player.name === playerName) {
      return savedPlayerId;
    }
  }

  return "";
}

function removePlayerFromRoom(io, socket, rooms, { roomCode, playerId, playerName }) {
  const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
  const cleanPlayerId = String(playerId ?? "").trim();
  const cleanPlayerName = String(playerName ?? "").trim();
  const room = rooms.get(cleanRoomCode);

  if (!room) {
    return;
  }

  const leavingPlayerId = findPlayerId(
    socket,
    room,
    cleanPlayerId,
    cleanPlayerName,
  );

  if (!leavingPlayerId) {
    return;
  }

  const leavingPlayer = room.players.get(leavingPlayerId);

  if (leavingPlayer?.reconnectTimeout) {
    clearTimeout(leavingPlayer.reconnectTimeout);
  }

  room.players.delete(leavingPlayerId);
  room.confirmationResponses.delete(leavingPlayerId);
  room.confirmationChangedVoters.delete(leavingPlayerId);
  room.readyPlayerIds.delete(leavingPlayerId);
  room.votes.delete(leavingPlayerId);

  for (const [voterId, votedPlayerId] of room.votes.entries()) {
    if (votedPlayerId === leavingPlayerId) {
      room.votes.delete(voterId);
      room.confirmationResponses.delete(voterId);
    }
  }

  if (room.pendingEliminationId === leavingPlayerId) {
    const voteCounts = setVoteSnapshot(room);
    const nextNomineeId = getHighestVotedPlayerId(voteCounts);

    room.pendingEliminationId = nextNomineeId;
    room.confirmationResponses = new Set();

    if (!nextNomineeId && ["defense", "confirmation"].includes(room.phase)) {
      room.phase = "simple";
      room.confirmationResponses = new Set();
      room.defenseEndsAt = 0;
      room.pendingEliminationId = "";
      room.revealVoteCounts = false;
      room.votes = new Map();
    }
  }

  socket.leave?.(cleanRoomCode);

  if (room.players.size === 0) {
    console.log("room deleted", {
      roomCode: cleanRoomCode,
    });
    rooms.delete(cleanRoomCode);
    return;
  }

  if (room.hostId === leavingPlayerId) {
    console.log("host left", {
      roomCode: cleanRoomCode,
      playerId: leavingPlayerId,
    });

    const nextHost =
      Array.from(room.players.values()).find((player) => player.connected) ??
      room.players.values().next().value;
    room.hostId = nextHost.id;
    nextHost.isHost = true;
    nextHost.alive = false;
    room.roles.delete(nextHost.id);
    room.votes.delete(nextHost.id);

    for (const [voterId, votedPlayerId] of room.votes.entries()) {
      if (votedPlayerId === nextHost.id) {
        room.votes.delete(voterId);
      }
    }

    console.log("host transferred", {
      roomCode: cleanRoomCode,
      newHostId: nextHost.id,
      newHostName: nextHost.name,
    });
  }

  emitRoomUpdated(io, cleanRoomCode, room);
}

function markPlayerDisconnected(io, rooms, roomCode, playerId, reason) {
  const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
  const room = rooms.get(cleanRoomCode);
  const player = room?.players.get(playerId);

  if (!room || !player || !player.connected) {
    return;
  }

  player.connected = false;
  player.disconnectedAt = Date.now();
  player.socketId = "";

  console.log("player temporarily disconnected", {
    roomCode: cleanRoomCode,
    playerId,
    playerName: player.name,
    reason,
  });

  if (player.reconnectTimeout) {
    clearTimeout(player.reconnectTimeout);
  }

  player.reconnectTimeout = setTimeout(() => {
    const currentRoom = rooms.get(cleanRoomCode);
    const currentPlayer = currentRoom?.players.get(playerId);

    if (!currentRoom || !currentPlayer || currentPlayer.connected) {
      return;
    }

    console.log("reconnect timeout expired", {
      roomCode: cleanRoomCode,
      playerId,
      playerName: currentPlayer.name,
    });

    removePlayerFromRoom(io, { id: playerId, data: { playerId }, leave: () => {} }, rooms, {
      roomCode: cleanRoomCode,
      playerId,
    });
  }, RECONNECT_GRACE_MS);

  emitRoomUpdated(io, cleanRoomCode, room);
}

function markPlayerDisconnectedFromAllRooms(io, socket, rooms, reason) {
  const playerId = getSocketPlayerId(socket);

  for (const roomCode of Array.from(rooms.keys())) {
    const room = rooms.get(roomCode);
    const player = room?.players.get(playerId);

    if (player?.socketId === socket.id) {
      markPlayerDisconnected(io, rooms, roomCode, playerId, reason);
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 100000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
  });
  res.end(JSON.stringify(payload));
}

app.prepare().then(() => {
  // Socket.io room state lives in memory only for now.
  // Restarting the server clears every room and player.
  const rooms = new Map();
  let io;
  const httpServer = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "POST" && requestUrl.pathname === "/api/create-room") {
      try {
        const startedAt = Date.now();
        const body = await readJsonBody(req);
        const cleanAvatarUrl = String(body.avatarUrl ?? "").trim();
        const cleanPlayerId = String(body.playerId ?? "").trim();
        const cleanPlayerName = String(body.playerName ?? "").trim();

        if (!cleanPlayerId || !cleanPlayerName) {
          sendJson(res, 400, { ok: false, error: "Enter your name first." });
          return;
        }

        const roomCode = createUniqueRoomCode(rooms);
        const room = createEmptyRoom(cleanPlayerId);
        const { error } = addHostToNewRoom(room, {
          avatarUrl: cleanAvatarUrl,
          playerId: cleanPlayerId,
          playerName: cleanPlayerName,
        });

        if (error) {
          sendJson(res, 400, { ok: false, error });
          return;
        }

        rooms.set(roomCode, room);
        console.log("room created via http", {
          elapsedMs: Date.now() - startedAt,
          hostId: cleanPlayerId,
          roomCode,
        });
        sendJson(res, 200, { isHost: true, ok: true, roomCode });
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : "Could not create room.",
        });
      }

      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/join-room") {
      try {
        const startedAt = Date.now();
        const body = await readJsonBody(req);
        const cleanAvatarUrl = String(body.avatarUrl ?? "").trim();
        const cleanPlayerId = String(body.playerId ?? "").trim();
        const cleanPlayerName = String(body.playerName ?? "").trim();
        const cleanRoomCode = String(body.roomCode ?? "").trim().toUpperCase();
        const room = rooms.get(cleanRoomCode);

        if (!cleanPlayerId || !cleanPlayerName || !cleanRoomCode) {
          sendJson(res, 400, {
            ok: false,
            error: "Enter your name and room code.",
          });
          return;
        }

        if (!room) {
          sendJson(res, 404, { ok: false, error: "Room does not exist." });
          return;
        }

        const existingPlayer = room.players.get(cleanPlayerId);

        if (existingPlayer) {
          existingPlayer.avatarUrl = cleanAvatarUrl || existingPlayer.avatarUrl;
          existingPlayer.name = cleanPlayerName || existingPlayer.name;
          sendJson(res, 200, {
            isHost: existingPlayer.isHost,
            ok: true,
            restored: true,
            roomCode: cleanRoomCode,
          });
          return;
        }

        if (room.gameStarted) {
          sendJson(res, 409, { ok: false, error: "Game already started." });
          return;
        }

        const { error, player } = addPlayerToRoom(room, {
          avatarUrl: cleanAvatarUrl,
          playerId: cleanPlayerId,
          playerName: cleanPlayerName,
        });

        if (error || !player) {
          sendJson(res, 400, { ok: false, error: error ?? "Room is full." });
          return;
        }

        console.log("player joined via http", {
          elapsedMs: Date.now() - startedAt,
          playerId: cleanPlayerId,
          roomCode: cleanRoomCode,
        });
        emitRoomUpdated(io, cleanRoomCode, room);
        sendJson(res, 200, {
          isHost: player.isHost,
          ok: true,
          restored: false,
          roomCode: cleanRoomCode,
        });
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : "Could not join room.",
        });
      }

      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/room-state") {
      const cleanRoomCode = String(requestUrl.searchParams.get("roomCode") ?? "")
        .trim()
        .toUpperCase();
      const cleanPlayerId = String(requestUrl.searchParams.get("playerId") ?? "")
        .trim();
      const room = rooms.get(cleanRoomCode);

      if (!cleanRoomCode || !cleanPlayerId) {
        sendJson(res, 400, {
          ok: false,
          error: "Room code and player id are required.",
        });
        return;
      }

      if (!room || !room.players.has(cleanPlayerId)) {
        sendJson(res, 404, { ok: false, error: "Room does not exist." });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        room: formatRoom(cleanRoomCode, room, cleanPlayerId),
      });
      return;
    }

    handle(req, res);
  });
  io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        if (!origin || ALLOWED_SOCKET_ORIGINS.has(origin)) {
          callback(null, true);
          return;
        }

        console.log("socket cors rejected", { origin });
        callback(new Error("Socket origin is not allowed."));
      },
    },
    path: "/socket.io/",
    transports: ["polling", "websocket"],
  });

  io.engine.on("connection_error", (error) => {
    console.log("socket connection_error", {
      code: error.code,
      context: error.context,
      message: error.message,
      reqUrl: error.req?.url,
    });
  });

  io.on("connection", (socket) => {
    const authPlayerId = String(socket.handshake.auth?.playerId ?? "").trim();

    console.log("socket new connection", {
      id: socket.id,
      origin: socket.handshake.headers.origin,
      playerId: authPlayerId,
      reqUrl: socket.request.url,
      transport: socket.conn.transport.name,
    });

    socket.conn.on("upgrade", (transport) => {
      console.log("socket transport upgraded", {
        id: socket.id,
        playerId: getSocketPlayerId(socket),
        transport: transport.name,
      });
    });

    if (authPlayerId) {
      socket.data.playerId = authPlayerId;
    }

    // Host creates a room on the server so the code is real before navigation.
    socket.on("create-room", ({ avatarUrl, playerId, playerName }, done) => {
      const createStartedAt = Date.now();
      const cleanAvatarUrl = String(avatarUrl ?? "").trim();
      const cleanPlayerId = String(playerId ?? "").trim() || socket.id;
      const cleanPlayerName = String(playerName ?? "").trim();

      if (!cleanPlayerName) {
        const error = "Enter your name first.";
        socket.emit("error-message", error);
        done?.({ ok: false, error });
        return;
      }

      const roomCode = createUniqueRoomCode(rooms);
      rooms.set(roomCode, {
        confirmationResponses: new Set(),
        confirmationChangedVoters: new Set(),
        cupidLoverIds: [],
        defenseEndsAt: 0,
        gameOver: false,
        gameStarted: false,
        hostId: cleanPlayerId,
        lastEliminatedPlayerId: "",
        lastVoteCounts: {},
        lastVoteTargets: [],
        nightActions: {
          detectiveTargetId: "",
          doctorTargetId: "",
          mafiaTargetId: "",
        },
        nightResultMessage: "",
        nightStep: "",
        pendingEliminationId: "",
        phase: "lobby",
        players: new Map(),
        readyPlayerIds: new Set(),
        revealVoteCounts: false,
        roles: new Map(),
        selectedRoles: [],
        votes: new Map(),
        winner: "",
      });

      const room = rooms.get(roomCode);
      const player = {
        alive: false,
        avatarUrl: cleanAvatarUrl,
        color: getRandomAvailableColor(room),
        connected: true,
        disconnectedAt: 0,
        icon: cleanAvatarUrl ? "" : getRandomAvailableIcon(room),
        id: cleanPlayerId,
        name: cleanPlayerName,
        isHost: true,
        reconnectTimeout: null,
        socketId: socket.id,
      };

      if (!player.color || (!player.avatarUrl && !player.icon)) {
        const error = "Room is full.";
        socket.emit("error-message", error);
        done?.({ ok: false, error });
        rooms.delete(roomCode);
        return;
      }

      room.players.set(cleanPlayerId, player);
      socket.data.playerId = cleanPlayerId;
      socket.data.roomCode = roomCode;

      console.log("room created", {
        elapsedMs: Date.now() - createStartedAt,
        roomCode,
        hostId: cleanPlayerId,
        playerName: cleanPlayerName,
      });

      socket.join(roomCode);
      emitRoomUpdated(io, roomCode, room);
      done?.({ isHost: true, ok: true, roomCode });
    });

    // Players can join only rooms already created in server memory.
    socket.on("join-room", ({
      avatarUrl,
      playerId,
      playerName,
      restoreRequestedAt,
      roomCode,
    }, done) => {
      const restoreStartedAt = Date.now();
      const cleanAvatarUrl = String(avatarUrl ?? "").trim();
      const cleanPlayerId = String(playerId ?? "").trim() || socket.id;
      const cleanPlayerName = String(playerName ?? "").trim();
      const cleanRestoreRequestedAt = Number(restoreRequestedAt) || 0;
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      console.log("join-room received", {
        playerId: cleanPlayerId,
        playerName: cleanPlayerName,
        roomCode: cleanRoomCode,
        socketId: socket.id,
        transport: socket.conn.transport.name,
      });

      if (!cleanPlayerName || !cleanRoomCode) {
        const error = "Enter your name and room code.";
        socket.emit("error-message", error);
        done?.({ ok: false, error });
        return;
      }

      if (!room) {
        const error = "Room does not exist.";
        socket.emit("error-message", error);
        done?.({ ok: false, error });
        return;
      }

      const existingPlayer = room.players.get(cleanPlayerId);

      if (existingPlayer) {
        if (existingPlayer.reconnectTimeout) {
          clearTimeout(existingPlayer.reconnectTimeout);
          existingPlayer.reconnectTimeout = null;
        }

        existingPlayer.avatarUrl = cleanAvatarUrl || existingPlayer.avatarUrl;
        existingPlayer.connected = true;
        existingPlayer.disconnectedAt = 0;
        existingPlayer.name = cleanPlayerName || existingPlayer.name;
        existingPlayer.socketId = socket.id;
        socket.data.playerId = cleanPlayerId;
        socket.data.roomCode = cleanRoomCode;
        socket.join(cleanRoomCode);

        console.log("session restore success", {
          elapsedMs: Date.now() - restoreStartedAt,
          networkElapsedMs: cleanRestoreRequestedAt
            ? Date.now() - cleanRestoreRequestedAt
            : undefined,
          roomCode: cleanRoomCode,
          playerId: cleanPlayerId,
          playerName: existingPlayer.name,
          phase: room.phase,
        });

        socket.emit("session-restored", {
          roomCode: cleanRoomCode,
          playerId: cleanPlayerId,
          role: existingPlayer.isHost ? "Moderator" : room.roles.get(cleanPlayerId) ?? "",
          phase: room.phase,
        });
        emitRoomUpdated(io, cleanRoomCode, room);
        done?.({
          isHost: existingPlayer.isHost,
          ok: true,
          restored: true,
          roomCode: cleanRoomCode,
        });
        return;
      }

      if (room.gameStarted) {
        const error = "Game already started.";
        socket.emit("error-message", error);
        done?.({ ok: false, error });
        return;
      }

      const player = {
        alive: true,
        avatarUrl: cleanAvatarUrl,
        color: getRandomAvailableColor(room),
        connected: true,
        disconnectedAt: 0,
        icon: cleanAvatarUrl ? "" : getRandomAvailableIcon(room),
        id: cleanPlayerId,
        name: cleanPlayerName,
        isHost: room.hostId === cleanPlayerId,
        reconnectTimeout: null,
        socketId: socket.id,
      };

      if (!player.color || (!player.avatarUrl && !player.icon)) {
        const error = "Room is full.";
        socket.emit("error-message", error);
        done?.({ ok: false, error });
        return;
      }

      room.players.set(cleanPlayerId, player);
      socket.data.playerId = cleanPlayerId;
      socket.data.roomCode = cleanRoomCode;
      socket.join(cleanRoomCode);

      console.log("player joined", {
        elapsedMs: Date.now() - restoreStartedAt,
        networkElapsedMs: cleanRestoreRequestedAt
          ? Date.now() - cleanRestoreRequestedAt
          : undefined,
        roomCode: cleanRoomCode,
        playerId: cleanPlayerId,
        playerName: cleanPlayerName,
        isHost: player.isHost,
      });

      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("change-color", ({ roomCode, color }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const cleanColor = String(color ?? "").trim();
      const room = rooms.get(cleanRoomCode);

      if (!room) {
        socket.emit("error-message", "Room does not exist.");
        return;
      }

      if (room.gameStarted) {
        socket.emit("error-message", "Colors can only be changed in lobby.");
        return;
      }

      if (!PLAYER_COLORS.includes(cleanColor)) {
        socket.emit("error-message", "Choose one of the available colors.");
        return;
      }

      const playerId = getSocketPlayerId(socket);
      const player = room.players.get(playerId);

      if (!player) {
        socket.emit("error-message", "Player not found.");
        return;
      }

      if (getUsedColors(room, playerId).has(cleanColor)) {
        socket.emit("error-message", "That color is already taken.");
        return;
      }

      player.color = cleanColor;
      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("change-icon", ({ roomCode, icon }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const cleanIcon = String(icon ?? "").trim();
      const room = rooms.get(cleanRoomCode);

      if (!room) {
        socket.emit("error-message", "Room does not exist.");
        return;
      }

      if (room.gameStarted) {
        socket.emit("error-message", "Icons can only be changed in lobby.");
        return;
      }

      if (!PLAYER_ICONS.includes(cleanIcon)) {
        socket.emit("error-message", "Choose one of the available icons.");
        return;
      }

      const playerId = getSocketPlayerId(socket);
      const player = room.players.get(playerId);

      if (!player) {
        socket.emit("error-message", "Player not found.");
        return;
      }

      if (player.avatarUrl) {
        socket.emit("error-message", "Profile photos replace face icons.");
        return;
      }

      if (getUsedIcons(room, playerId).has(cleanIcon)) {
        socket.emit("error-message", "That icon is already taken.");
        return;
      }

      player.icon = cleanIcon;
      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("add-bots", ({ roomCode, count, playerId } = {}, done) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const cleanCount = Math.max(1, Math.min(10, Number(count) || 1));
      const cleanPlayerId = String(playerId ?? getSocketPlayerId(socket)).trim();
      const room = rooms.get(cleanRoomCode);
      const fail = (error) => {
        socket.emit("error-message", error);
        done?.({ ok: false, error });
      };

      if (!room) {
        fail("Room does not exist.");
        return;
      }

      if (room.hostId !== cleanPlayerId) {
        fail("Only the moderator can add bots.");
        return;
      }

      if (room.gameStarted) {
        fail("Bots can only be added in lobby.");
        return;
      }

      const existingBotCount = Array.from(room.players.values()).filter(
        (player) => player.isBot,
      ).length;
      let addedCount = 0;

      for (let index = 0; index < cleanCount; index += 1) {
        const bot = createBotPlayer(room, existingBotCount + addedCount + 1);

        if (!bot) {
          break;
        }

        room.players.set(bot.id, bot);
        room.readyPlayerIds.add(bot.id);
        addedCount += 1;
      }

      if (addedCount === 0) {
        fail("No more bot slots are available.");
        return;
      }

      socket.data.playerId = cleanPlayerId;
      socket.data.roomCode = cleanRoomCode;
      console.log("bots added", {
        count: addedCount,
        roomCode: cleanRoomCode,
      });
      emitRoomUpdated(io, cleanRoomCode, room);
      done?.({ addedCount, ok: true });
    });

    socket.on("clear-bots", ({ roomCode, playerId } = {}, done) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const cleanPlayerId = String(playerId ?? getSocketPlayerId(socket)).trim();
      const room = rooms.get(cleanRoomCode);
      const fail = (error) => {
        socket.emit("error-message", error);
        done?.({ ok: false, error });
      };

      if (!room) {
        fail("Room does not exist.");
        return;
      }

      if (room.hostId !== cleanPlayerId) {
        fail("Only the moderator can clear bots.");
        return;
      }

      if (room.gameStarted) {
        fail("Bots can only be cleared in lobby.");
        return;
      }

      let removedCount = 0;
      for (const player of room.players.values()) {
        if (player.isBot) {
          room.players.delete(player.id);
          room.readyPlayerIds.delete(player.id);
          removedCount += 1;
        }
      }

      socket.data.playerId = cleanPlayerId;
      socket.data.roomCode = cleanRoomCode;
      console.log("bots cleared", {
        count: removedCount,
        roomCode: cleanRoomCode,
      });
      emitRoomUpdated(io, cleanRoomCode, room);
      done?.({ ok: true, removedCount });
    });

    socket.on("add-selected-role", ({ roomCode, role }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const cleanRole = String(role ?? "").trim();
      const room = rooms.get(cleanRoomCode);

      if (!room) {
        socket.emit("error-message", "Room does not exist.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the moderator can edit roles.");
        return;
      }

      if (room.gameStarted) {
        socket.emit("error-message", "Roles can only be changed in lobby.");
        return;
      }

      if (!ROLE_OPTIONS.includes(cleanRole)) {
        socket.emit("error-message", "Choose a valid role.");
        return;
      }

      room.selectedRoles.push(cleanRole);
      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("remove-selected-role", ({ roomCode, roleIndex }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const cleanRoleIndex = Number(roleIndex);
      const room = rooms.get(cleanRoomCode);

      if (!room) {
        socket.emit("error-message", "Room does not exist.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the moderator can edit roles.");
        return;
      }

      if (room.gameStarted) {
        socket.emit("error-message", "Roles can only be changed in lobby.");
        return;
      }

      if (!Number.isInteger(cleanRoleIndex) || cleanRoleIndex < 0) {
        socket.emit("error-message", "Choose a valid role.");
        return;
      }

      room.selectedRoles.splice(cleanRoleIndex, 1);
      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("set-selected-roles", ({ roomCode, roles }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const cleanRoles = cleanSelectedRoles(roles);
      const room = rooms.get(cleanRoomCode);

      if (!room) {
        socket.emit("error-message", "Room does not exist.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the moderator can edit roles.");
        return;
      }

      if (room.gameStarted) {
        socket.emit("error-message", "Roles can only be changed in lobby.");
        return;
      }

      room.selectedRoles = cleanRoles;
      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("toggle-ready", ({ roomCode }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      if (!room) {
        socket.emit("error-message", "Room does not exist.");
        return;
      }

      if (room.gameStarted) {
        socket.emit("error-message", "Game already started.");
        return;
      }

      const playerId = getSocketPlayerId(socket);
      const player = room.players.get(playerId);

      if (!player || player.isHost) {
        socket.emit("error-message", "Only players can ready up.");
        return;
      }

      if (room.readyPlayerIds.has(playerId)) {
        room.readyPlayerIds.delete(playerId);
      } else {
        room.readyPlayerIds.add(playerId);
      }

      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("cancel-game", ({ roomCode }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      if (!room) {
        socket.emit("error-message", "Room does not exist.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the host can cancel the game.");
        return;
      }

      resetRoomToLobby(room);
      emitRoomUpdated(io, cleanRoomCode, room);
      done?.({
        isHost: player.isHost,
        ok: true,
        restored: false,
        roomCode: cleanRoomCode,
      });
    });

    socket.on("set-cupid-lovers", ({ roomCode, loverIds }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const cleanLoverIds = Array.isArray(loverIds)
        ? loverIds.map((loverId) => String(loverId ?? "").trim()).filter(Boolean)
        : [];
      const room = rooms.get(cleanRoomCode);

      if (!room || !room.gameStarted || room.gameOver) {
        socket.emit("error-message", "Cupid lovers can only be set during a game.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the moderator can set Cupid lovers.");
        return;
      }

      if (!Array.from(room.roles.values()).includes("Cupid")) {
        socket.emit("error-message", "Cupid is not in this game.");
        return;
      }

      if (cleanLoverIds.length !== 2 || cleanLoverIds[0] === cleanLoverIds[1]) {
        socket.emit("error-message", "Choose two different lovers.");
        return;
      }

      const lovers = cleanLoverIds.map((loverId) => room.players.get(loverId));

      if (
        lovers.some(
          (lover) => !lover || lover.isHost || !lover.alive,
        )
      ) {
        socket.emit("error-message", "Choose two alive players.");
        return;
      }

      room.cupidLoverIds = cleanLoverIds;
      console.log("cupid lovers set", {
        roomCode: cleanRoomCode,
        loverIds: cleanLoverIds,
      });
      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("start-game", ({ roomCode, selectedRoles }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const incomingSelectedRoles = cleanSelectedRoles(selectedRoles);
      const room = rooms.get(cleanRoomCode);

      console.log("server received start-game", {
        roomCode: cleanRoomCode,
        socketId: socket.id,
        playerId: getSocketPlayerId(socket),
      });

      if (!room) {
        socket.emit("error-message", "Room does not exist.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the host can start the game.");
        return;
      }

      const gamePlayers = getGamePlayers(room);
      if (incomingSelectedRoles.length > 0) {
        room.selectedRoles = incomingSelectedRoles;
      }

      const allPlayersReady =
        gamePlayers.length > 0 &&
        gamePlayers.every((player) => room.readyPlayerIds.has(player.id));

      if (!allPlayersReady) {
        socket.emit("error-message", "Waiting for all players to be ready.");
        return;
      }

      if (room.selectedRoles.length !== gamePlayers.length) {
        socket.emit("error-message", "Add one role for each player.");
        return;
      }

      room.gameStarted = true;
      room.gameOver = false;
      room.phase = "simple";
      room.cupidLoverIds = [];
      room.votes = new Map();
      room.revealVoteCounts = false;
      for (const player of room.players.values()) {
        player.alive = !player.isHost;
      }
      room.roles = assignSelectedRoles(gamePlayers, room.selectedRoles);
      room.winner = "";

      console.log("roles assigned", {
        roomCode: cleanRoomCode,
        playerCount: room.players.size,
      });

      emitGameStarted(io, cleanRoomCode, room);
    });

    socket.on("vote-player", ({ roomCode, targetPlayerId }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const cleanTargetPlayerId = String(targetPlayerId ?? "").trim();
      const room = rooms.get(cleanRoomCode);

      if (!room || !room.gameStarted || room.gameOver || room.phase !== "day") {
        socket.emit("error-message", "Voting is not active.");
        return;
      }

      const voterId = getSocketPlayerId(socket);
      const voter = room.players.get(voterId);
      const targetPlayer = room.players.get(cleanTargetPlayerId);

      if (!voter || voter.isHost || !targetPlayer || targetPlayer.isHost) {
        socket.emit("error-message", "Player not found.");
        return;
      }

      if (!voter.alive) {
        socket.emit("error-message", "Dead players cannot vote.");
        return;
      }

      if (!targetPlayer.alive) {
        socket.emit("error-message", "You can only vote for alive players.");
        return;
      }

      if (voter.id === targetPlayer.id) {
        socket.emit("error-message", "You cannot vote for yourself.");
        return;
      }

      room.votes.set(voter.id, targetPlayer.id);
      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("moderator-bot-vote", ({
      roomCode,
      botPlayerId,
      targetPlayerId,
      playerId,
    } = {}, done) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const cleanBotPlayerId = String(botPlayerId ?? "").trim();
      const cleanTargetPlayerId = String(targetPlayerId ?? "").trim();
      const cleanPlayerId = String(playerId ?? getSocketPlayerId(socket)).trim();
      const room = rooms.get(cleanRoomCode);
      const fail = (error) => {
        socket.emit("error-message", error);
        done?.({ ok: false, error });
      };

      if (!room || !room.gameStarted || room.gameOver || room.phase !== "day") {
        fail("Voting is not active.");
        return;
      }

      if (room.hostId !== cleanPlayerId) {
        fail("Only the moderator can vote for bots.");
        return;
      }

      const botPlayer = room.players.get(cleanBotPlayerId);
      const targetPlayer = room.players.get(cleanTargetPlayerId);

      if (
        !botPlayer ||
        !botPlayer.isBot ||
        !targetPlayer ||
        targetPlayer.isHost
      ) {
        fail("Player not found.");
        return;
      }

      if (!botPlayer.alive) {
        fail("Dead bots cannot vote.");
        return;
      }

      if (!targetPlayer.alive) {
        fail("Bots can only vote for alive players.");
        return;
      }

      if (botPlayer.id === targetPlayer.id) {
        fail("A bot cannot vote for itself.");
        return;
      }

      socket.data.playerId = cleanPlayerId;
      socket.data.roomCode = cleanRoomCode;
      room.votes.set(botPlayer.id, targetPlayer.id);
      console.log("bot vote submitted", {
        botPlayerId: botPlayer.id,
        roomCode: cleanRoomCode,
        targetPlayerId: targetPlayer.id,
      });
      emitRoomUpdated(io, cleanRoomCode, room);
      done?.({ ok: true });
    });

    socket.on("open-voting", ({ roomCode }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      if (!room || !room.gameStarted || room.gameOver) {
        socket.emit("error-message", "Simple voting is not available.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the moderator can open voting.");
        return;
      }

      room.phase = "day";
      room.votes = new Map();
      room.lastVoteCounts = {};
      room.lastVoteTargets = [];
      room.revealVoteCounts = false;
      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("end-voting", ({ roomCode }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      if (!room || !room.gameStarted || room.gameOver || room.phase !== "day") {
        socket.emit("error-message", "Voting is not active.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the host can end voting.");
        return;
      }

      const allAlivePlayersVoted = getAliveGamePlayers(room).every((player) =>
        room.votes.has(player.id),
      );

      if (!allAlivePlayersVoted) {
        socket.emit("error-message", "Waiting for all alive players to vote.");
        return;
      }

      const voteCounts = setVoteSnapshot(room);

      const nomineeId = getHighestVotedPlayerId(voteCounts);

      room.confirmationChangedVoters = new Set();
      room.lastEliminatedPlayerId = "";
      startDefensePhase(room, nomineeId);

      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("reveal-votes", ({ roomCode }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      if (
        !room ||
        !room.gameStarted ||
        room.gameOver ||
        room.phase !== "simple-vote-results"
      ) {
        socket.emit("error-message", "Vote results are not ready.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the moderator can reveal votes.");
        return;
      }

      room.revealVoteCounts = true;
      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("delete-vote-results", ({ roomCode }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      if (!room || !room.gameStarted) {
        socket.emit("error-message", "Vote results are not available.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the moderator can clear votes.");
        return;
      }

      room.phase = "simple";
      room.votes = new Map();
      room.lastVoteCounts = {};
      room.lastVoteTargets = [];
      room.revealVoteCounts = false;
      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("moderator-kill-player", ({ roomCode, targetPlayerId }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const cleanTargetPlayerId = String(targetPlayerId ?? "").trim();
      const room = rooms.get(cleanRoomCode);

      if (!room || !room.gameStarted || room.gameOver) {
        socket.emit("error-message", "Game is not active.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the moderator can kill players.");
        return;
      }

      const targetPlayer = room.players.get(cleanTargetPlayerId);

      if (!targetPlayer || targetPlayer.isHost) {
        socket.emit("error-message", "Choose a player.");
        return;
      }

      targetPlayer.alive = false;
      room.lastEliminatedPlayerId = targetPlayer.id;

      for (const [voterId, votedPlayerId] of room.votes.entries()) {
        if (voterId === targetPlayer.id || votedPlayerId === targetPlayer.id) {
          room.votes.delete(voterId);
        }
      }

      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("defense-done", ({ roomCode }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      if (!room || !room.gameStarted || room.gameOver || room.phase !== "defense") {
        socket.emit("error-message", "Defense phase is not active.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the moderator can finish defense.");
        return;
      }

      room.confirmationResponses = new Set();
      room.defenseEndsAt = 0;
      room.phase = "confirmation";
      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("confirmation-vote", ({ roomCode, choice, targetPlayerId }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const cleanChoice = String(choice ?? "").trim();
      const cleanTargetPlayerId = String(targetPlayerId ?? "").trim();
      const room = rooms.get(cleanRoomCode);

      if (!room || !room.gameStarted || room.gameOver || room.phase !== "confirmation") {
        socket.emit("error-message", "Confirmation voting is not active.");
        return;
      }

      const voterId = getSocketPlayerId(socket);
      const voter = room.players.get(voterId);
      const confirmationVoterIds = getConfirmationVoterIds(room);

      if (!voter || !confirmationVoterIds.includes(voterId)) {
        socket.emit("error-message", "You cannot change this vote.");
        return;
      }

      if (room.confirmationResponses.has(voterId)) {
        socket.emit("error-message", "Your confirmation vote is already submitted.");
        return;
      }

      if (cleanChoice === "keep") {
        room.confirmationResponses.add(voterId);
      } else if (cleanChoice === "change") {
        const targetPlayer = room.players.get(cleanTargetPlayerId);

        if (!targetPlayer || targetPlayer.isHost || !targetPlayer.alive) {
          socket.emit("error-message", "Choose an alive player.");
          return;
        }

        if (targetPlayer.id === voter.id) {
          socket.emit("error-message", "You cannot vote for yourself.");
          return;
        }

        if (targetPlayer.id === room.pendingEliminationId) {
          socket.emit("error-message", "Choose a different player.");
          return;
        }

        room.votes.set(voterId, targetPlayer.id);
        room.confirmationChangedVoters.add(voterId);
        room.confirmationResponses.add(voterId);
        setVoteSnapshot(room);
      } else {
        socket.emit("error-message", "Choose keep or change.");
        return;
      }

      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("finish-confirmation", ({ roomCode }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      if (!room || !room.gameStarted || room.gameOver || room.phase !== "confirmation") {
        socket.emit("error-message", "Confirmation voting is not active.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the moderator can show the result.");
        return;
      }

      const confirmationVoterIds = getConfirmationVoterIds(room);
      const allConfirmationVotesSubmitted = confirmationVoterIds.every((playerId) =>
        room.confirmationResponses.has(playerId),
      );

      if (!allConfirmationVotesSubmitted) {
        socket.emit("error-message", "Waiting for confirmation votes.");
        return;
      }

      const voteCounts = setVoteSnapshot(room);
      const nextNomineeId = getHighestVotedPlayerId(voteCounts);

      if (nextNomineeId && nextNomineeId !== room.pendingEliminationId) {
        startDefensePhase(room, nextNomineeId);
      } else {
        setVoteSnapshot(room);
        room.confirmationResponses = new Set();
        room.defenseEndsAt = 0;
        room.phase = "simple-vote-results";
        room.revealVoteCounts = false;
      }

      emitRoomUpdated(io, cleanRoomCode, room);
    });

    socket.on("move-to-night", ({ roomCode }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      if (!room || !room.gameStarted || room.gameOver || room.phase !== "day-results") {
        socket.emit("error-message", "Night phase is not ready.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the host can move to night.");
        return;
      }

      startNightPhase(room);
      emitRoomUpdated(io, cleanRoomCode, room);
    });

    function advanceNightStepOrResolve(cleanRoomCode, room) {
      if (
        room.nightStep === "Detective" &&
        getAliveMafiaPlayers(room).length > 0
      ) {
        room.nightStep = "Mafia";
      } else if (
        ["Detective", "Mafia"].includes(room.nightStep) &&
        getAlivePlayersByRole(room, "Doctor").length > 0
      ) {
        room.nightStep = "Doctor";
      } else {
        room.nightStep = "";
        resolveNightIfReady(cleanRoomCode, room);
        return;
      }

      emitRoomUpdated(io, cleanRoomCode, room);
    }

    function resolveNightIfReady(cleanRoomCode, room) {
      const aliveRoleEntries = getAliveGamePlayers(room).map((player) => [
        player.id,
        room.roles.get(player.id),
      ]);
      const hasAliveMafia = aliveRoleEntries.some(([, role]) => isMafiaRole(role));
      const hasAliveDoctor = aliveRoleEntries.some(([, role]) => role === "Doctor");
      const hasAliveDetective = aliveRoleEntries.some(
        ([, role]) => role === "Detective",
      );
      const mafiaReady = !hasAliveMafia || Boolean(room.nightActions.mafiaTargetId);
      const doctorReady =
        !hasAliveDoctor || Boolean(room.nightActions.doctorTargetId);
      const detectiveReady =
        !hasAliveDetective || Boolean(room.nightActions.detectiveTargetId);

      if (!mafiaReady || !doctorReady || !detectiveReady) {
        return;
      }

      const killedPlayer = room.players.get(room.nightActions.mafiaTargetId);
      const savedPlayerId = room.nightActions.doctorTargetId;

      if (killedPlayer && killedPlayer.id !== savedPlayerId) {
        killedPlayer.alive = false;
        room.nightResultMessage = `${killedPlayer.name} was killed during the night.`;
      } else if (killedPlayer && killedPlayer.id === savedPlayerId) {
        room.nightResultMessage = "The Doctor saved the target. Nobody died.";
      } else {
        room.nightResultMessage = "Nobody died during the night.";
      }

      if (!checkWinCondition(room)) {
        resetDayVotes(room);
      }

      emitRoomUpdated(io, cleanRoomCode, room);
    }

    socket.on("night-action", ({ roomCode }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      if (!room || !room.gameStarted || room.gameOver || room.phase !== "night") {
        socket.emit("error-message", "Night actions are not active.");
        return;
      }

      socket.emit("error-message", "The moderator submits night actions.");
    });

    socket.on("moderator-night-action", ({ roomCode, targetPlayerId }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const cleanTargetPlayerId = String(targetPlayerId ?? "").trim();
      const room = rooms.get(cleanRoomCode);

      if (!room || !room.gameStarted || room.gameOver || room.phase !== "night") {
        socket.emit("error-message", "Night actions are not active.");
        return;
      }

      if (room.hostId !== getSocketPlayerId(socket)) {
        socket.emit("error-message", "Only the moderator can submit night actions.");
        return;
      }

      const targetPlayer = room.players.get(cleanTargetPlayerId);

      if (!targetPlayer || targetPlayer.isHost || !targetPlayer.alive) {
        socket.emit("error-message", "Choose an alive player.");
        return;
      }

      if (room.nightStep === "Detective") {
        room.nightActions.detectiveTargetId = targetPlayer.id;
        const detective = getAlivePlayersByRole(room, "Detective")[0];

        if (detective) {
          const targetRole = room.roles.get(targetPlayer.id);
          const detectedAsMafia = isDetectiveMafiaResult(targetRole);

          if (detective.socketId) {
            io.to(detective.socketId).emit("detective-result", {
            detectedParty: detectedAsMafia ? "Mafia" : "Villager",
            isMafia: detectedAsMafia,
            targetName: targetPlayer.name,
            });
          }
        }
      } else if (room.nightStep === "Mafia") {
        room.nightActions.mafiaTargetId = targetPlayer.id;
      } else if (room.nightStep === "Doctor") {
        room.nightActions.doctorTargetId = targetPlayer.id;
      } else {
        socket.emit("error-message", "No night action is waiting.");
        return;
      }

      advanceNightStepOrResolve(cleanRoomCode, room);
    });

    // Explicit leave handles browser back/navigation before disconnecting the socket.
    socket.on("leave-room", ({ roomCode, playerId, playerName } = {}, done) => {
      console.log("leave-room received", {
        socketId: socket.id,
        socketPlayerId: getSocketPlayerId(socket),
        roomCode,
        playerId,
        playerName,
      });

      removePlayerFromRoom(io, socket, rooms, {
        roomCode,
        playerId,
        playerName,
      });

      if (typeof done === "function") {
        done();
      }
    });

    // Disconnect handles closing the tab, refreshing, losing connection, or closing the browser.
    socket.on("disconnect", (reason) => {
      console.log("disconnect received", {
        origin: socket.handshake.headers.origin,
        socketId: socket.id,
        playerId: getSocketPlayerId(socket),
        reason,
        transport: socket.conn.transport.name,
      });

      markPlayerDisconnectedFromAllRooms(io, socket, rooms, reason);
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
