import { io } from "socket.io-client";

const socketUrl =
  typeof window === "undefined" ? undefined : window.location.origin;
const playerIdStorageKey = "mafiaPlayerId";

export function getStablePlayerId() {
  if (typeof window === "undefined") {
    return "";
  }

  const savedPlayerId = localStorage.getItem(playerIdStorageKey);

  if (savedPlayerId) {
    return savedPlayerId;
  }

  const nextPlayerId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  localStorage.setItem(playerIdStorageKey, nextPlayerId);
  return nextPlayerId;
}

if (typeof window !== "undefined") {
  console.log("Socket.io connection URL", socketUrl);
}

export const socket = io(socketUrl, {
  autoConnect: false,
  auth: () => ({
    playerId: getStablePlayerId(),
  }),
  closeOnBeforeunload: false,
  forceNew: false,
  multiplex: true,
  rememberUpgrade: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.5,
  timeout: 10000,
  transports: ["websocket", "polling"],
  tryAllTransports: true,
  upgrade: true,
});

if (typeof window !== "undefined") {
  let isUpgradeLoggerAttached = false;

  socket.on("connect", () => {
    console.log("Socket.io connected", {
      id: socket.id,
      transport: socket.io.engine.transport.name,
      url: socketUrl,
    });

    if (!isUpgradeLoggerAttached) {
      isUpgradeLoggerAttached = true;
      socket.io.engine.on("upgrade", (transport: { name: string }) => {
        console.log("Socket.io transport upgraded", {
          transport: transport.name,
          url: socketUrl,
        });
      });
    }
  });

  socket.on("connect_error", (error) => {
    console.log("Socket.io connect_error", {
      message: error.message,
      playerId: getStablePlayerId(),
      url: socketUrl,
    });
  });

  socket.io.on("reconnect_attempt", (attempt) => {
    console.log("Socket.io reconnect attempt", {
      attempt,
      playerId: getStablePlayerId(),
      url: socketUrl,
    });
  });

  socket.io.on("reconnect", (attempt) => {
    console.log("Socket.io reconnect success", {
      attempt,
      id: socket.id,
      playerId: getStablePlayerId(),
      url: socketUrl,
    });
  });

  socket.io.on("reconnect_error", (error) => {
    console.log("Socket.io reconnect failure", {
      message: error.message,
      playerId: getStablePlayerId(),
      url: socketUrl,
    });
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket.io disconnected", {
      id: socket.id,
      playerId: getStablePlayerId(),
      reason,
      url: socketUrl,
    });
  });

}
