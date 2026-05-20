import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = Number(process.env.PORT) || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

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

function formatRoom(roomCode, room) {
  return {
    gameStarted: room.gameStarted,
    lastEliminatedPlayerId: room.lastEliminatedPlayerId,
    phase: room.phase,
    revealVoteCounts: room.revealVoteCounts,
    roomCode,
    players: Array.from(room.players.values()),
    voteCounts: room.revealVoteCounts ? room.lastVoteCounts : {},
  };
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

function assignRoles(players) {
  const shuffledPlayers = shufflePlayers(players);
  const roles = new Map();
  const specialRoles = ["Mafia", "Doctor", "Detective"];

  shuffledPlayers.forEach((player, index) => {
    roles.set(player.id, specialRoles[index] ?? "Villager");
  });

  return roles;
}

function emitGameStarted(io, roomCode, room) {
  const publicPlayers = Array.from(room.players.values());

  for (const player of publicPlayers) {
    io.to(player.id).emit("game-started", {
      phase: room.phase,
      roomCode,
      role: room.roles.get(player.id),
      players: publicPlayers,
      voteCounts: {},
      revealVoteCounts: false,
    });
  }

  io.to(roomCode).emit("room-updated", formatRoom(roomCode, room));
}

function resetDayVotes(room) {
  room.phase = "day";
  room.votes = new Map();
  room.revealVoteCounts = false;
}

function resetRoomToLobby(room) {
  room.gameStarted = false;
  room.lastEliminatedPlayerId = "";
  room.lastVoteCounts = {};
  room.phase = "lobby";
  room.revealVoteCounts = false;
  room.roles = new Map();
  room.votes = new Map();

  for (const player of room.players.values()) {
    player.alive = true;
  }
}

function findPlayerId(socket, room, playerId, playerName) {
  if (playerId && room.players.has(playerId)) {
    return playerId;
  }

  if (room.players.has(socket.id)) {
    return socket.id;
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

  room.players.delete(leavingPlayerId);
  room.votes.delete(leavingPlayerId);

  for (const [voterId, votedPlayerId] of room.votes.entries()) {
    if (votedPlayerId === leavingPlayerId) {
      room.votes.delete(voterId);
    }
  }

  socket.leave(cleanRoomCode);

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

    const nextHost = room.players.values().next().value;
    room.hostId = nextHost.id;
    nextHost.isHost = true;

    console.log("host transferred", {
      roomCode: cleanRoomCode,
      newHostId: nextHost.id,
      newHostName: nextHost.name,
    });
  }

  io.to(cleanRoomCode).emit("room-updated", formatRoom(cleanRoomCode, room));
}

function removePlayerFromAllRooms(io, socket, rooms) {
  for (const roomCode of Array.from(rooms.keys())) {
    removePlayerFromRoom(io, socket, rooms, {
      roomCode,
      playerId: socket.id,
    });
  }
}

app.prepare().then(() => {
  const httpServer = createServer(handle);
  const io = new Server(httpServer);

  // Socket.io room state lives in memory only for now.
  // Restarting the server clears every room and player.
  const rooms = new Map();

  io.on("connection", (socket) => {
    // Host creates a room on the server so the code is real before navigation.
    socket.on("create-room", ({ playerName }) => {
      const cleanPlayerName = String(playerName ?? "").trim();

      if (!cleanPlayerName) {
        socket.emit("error-message", "Enter your name first.");
        return;
      }

      const roomCode = createUniqueRoomCode(rooms);
      const player = {
        alive: true,
        id: socket.id,
        name: cleanPlayerName,
        isHost: true,
      };

      rooms.set(roomCode, {
        gameStarted: false,
        hostId: socket.id,
        lastEliminatedPlayerId: "",
        lastVoteCounts: {},
        phase: "lobby",
        players: new Map([[socket.id, player]]),
        revealVoteCounts: false,
        roles: new Map(),
        votes: new Map(),
      });

      console.log("room created", {
        roomCode,
        hostId: socket.id,
        playerName: cleanPlayerName,
      });

      socket.join(roomCode);
      io.to(roomCode).emit("room-updated", formatRoom(roomCode, rooms.get(roomCode)));
    });

    // Players can join only rooms already created in server memory.
    socket.on("join-room", ({ playerName, roomCode }) => {
      const cleanPlayerName = String(playerName ?? "").trim();
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      if (!cleanPlayerName || !cleanRoomCode) {
        socket.emit("error-message", "Enter your name and room code.");
        return;
      }

      if (!room) {
        socket.emit("error-message", "Room does not exist.");
        return;
      }

      if (room.gameStarted) {
        socket.emit("error-message", "Game already started.");
        return;
      }

      const player = {
        alive: true,
        id: socket.id,
        name: cleanPlayerName,
        isHost: room.hostId === socket.id,
      };

      room.players.set(socket.id, player);
      socket.join(cleanRoomCode);

      console.log("player joined", {
        roomCode: cleanRoomCode,
        playerId: socket.id,
        playerName: cleanPlayerName,
        isHost: player.isHost,
      });

      io.to(cleanRoomCode).emit("room-updated", formatRoom(cleanRoomCode, room));
    });

    socket.on("cancel-game", ({ roomCode }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      if (!room) {
        socket.emit("error-message", "Room does not exist.");
        return;
      }

      if (room.hostId !== socket.id) {
        socket.emit("error-message", "Only the host can cancel the game.");
        return;
      }

      resetRoomToLobby(room);
      io.to(cleanRoomCode).emit("room-updated", formatRoom(cleanRoomCode, room));
    });

    socket.on("start-game", ({ roomCode }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      console.log("server received start-game", {
        roomCode: cleanRoomCode,
        socketId: socket.id,
      });

      if (!room) {
        socket.emit("error-message", "Room does not exist.");
        return;
      }

      if (room.hostId !== socket.id) {
        socket.emit("error-message", "Only the host can start the game.");
        return;
      }

      if (room.players.size < 4) {
        socket.emit("error-message", "At least 4 players are required.");
        return;
      }

      room.gameStarted = true;
      resetDayVotes(room);
      room.roles = assignRoles(Array.from(room.players.values()));

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

      if (!room || !room.gameStarted || room.phase !== "day") {
        socket.emit("error-message", "Voting is not active.");
        return;
      }

      const voter = room.players.get(socket.id);
      const targetPlayer = room.players.get(cleanTargetPlayerId);

      if (!voter || !targetPlayer) {
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
      io.to(cleanRoomCode).emit("room-updated", formatRoom(cleanRoomCode, room));
    });

    socket.on("end-voting", ({ roomCode }) => {
      const cleanRoomCode = String(roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(cleanRoomCode);

      if (!room || !room.gameStarted || room.phase !== "day") {
        socket.emit("error-message", "Voting is not active.");
        return;
      }

      if (room.hostId !== socket.id) {
        socket.emit("error-message", "Only the host can end voting.");
        return;
      }

      const voteCounts = {};

      for (const targetPlayerId of room.votes.values()) {
        voteCounts[targetPlayerId] = (voteCounts[targetPlayerId] ?? 0) + 1;
      }

      let eliminatedPlayerId = "";
      let highestVotes = 0;

      for (const [playerId, voteCount] of Object.entries(voteCounts)) {
        if (voteCount > highestVotes) {
          eliminatedPlayerId = playerId;
          highestVotes = voteCount;
        }
      }

      if (eliminatedPlayerId && highestVotes > 0) {
        const eliminatedPlayer = room.players.get(eliminatedPlayerId);

        if (eliminatedPlayer) {
          eliminatedPlayer.alive = false;
        }
      }

      room.lastEliminatedPlayerId = eliminatedPlayerId;
      room.lastVoteCounts = voteCounts;
      room.revealVoteCounts = true;
      resetDayVotes(room);
      room.revealVoteCounts = true;
      io.to(cleanRoomCode).emit("room-updated", formatRoom(cleanRoomCode, room));
    });

    // Explicit leave handles browser back/navigation before disconnecting the socket.
    socket.on("leave-room", ({ roomCode, playerId, playerName } = {}, done) => {
      console.log("leave-room received", {
        socketId: socket.id,
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
        socketId: socket.id,
        reason,
      });

      removePlayerFromAllRooms(io, socket, rooms);
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
