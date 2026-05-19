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
    roomCode,
    players: Array.from(room.players.values()),
  };
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
  socket.leave(cleanRoomCode);

  if (room.players.size === 0) {
    console.log("room deleted", {
      roomCode: cleanRoomCode,
    });
    rooms.delete(cleanRoomCode);
    return;
  }

  if (room.hostId === leavingPlayerId) {
    const nextHost = room.players.values().next().value;
    room.hostId = nextHost.id;
    nextHost.isHost = true;
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
        id: socket.id,
        name: cleanPlayerName,
        isHost: true,
      };

      rooms.set(roomCode, {
        hostId: socket.id,
        players: new Map([[socket.id, player]]),
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

      const player = {
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
