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

export function setStablePlayerId(playerId: string) {
  if (typeof window === "undefined") {
    return;
  }

  const cleanPlayerId = playerId.trim();

  if (cleanPlayerId) {
    localStorage.setItem(playerIdStorageKey, cleanPlayerId);
  }
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
  path: "/socket.io/",
  rememberUpgrade: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.5,
  timeout: 10000,
  transports: ["polling", "websocket"],
  tryAllTransports: true,
  upgrade: true,
});

export function connectSocketWithTimeout(timeoutMs = 10000) {
  if (socket.connected) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const startedAt = performance.now();
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Socket connection timed out."));
    }, timeoutMs);

    function cleanup() {
      window.clearTimeout(timeout);
      socket.off("connect", handleConnect);
    }

    function handleConnect() {
      cleanup();
      console.log("Socket.io connect ready", {
        elapsedMs: Math.round(performance.now() - startedAt),
        id: socket.id,
        playerId: getStablePlayerId(),
      });
      resolve();
    }

    socket.once("connect", handleConnect);
    socket.connect();
  });
}

if (typeof window !== "undefined") {
  let isUpgradeLoggerAttached = false;

  socket.on("connect", () => {
    console.log("Socket.io connected", {
      id: socket.id,
      path: "/socket.io/",
      playerId: getStablePlayerId(),
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

      socket.io.engine.on("packet", (packet: { type: string }) => {
        if (packet.type === "ping" || packet.type === "pong") {
          return;
        }

        console.log("Socket.io engine packet", {
          type: packet.type,
          transport: socket.io.engine.transport.name,
          url: socketUrl,
        });
      });
    }
  });

  socket.on("connect_error", (error) => {
    console.log("Socket.io connect_error", {
      message: error.message,
      path: "/socket.io/",
      playerId: getStablePlayerId(),
      transport: socket.io.engine?.transport?.name,
      url: socketUrl,
    });
  });

  socket.io.on("reconnect_attempt", (attempt) => {
    console.log("Socket.io reconnect attempt", {
      attempt,
      path: "/socket.io/",
      playerId: getStablePlayerId(),
      transport: socket.io.engine?.transport?.name,
      url: socketUrl,
    });
  });

  socket.io.on("reconnect", (attempt) => {
    console.log("Socket.io reconnect success", {
      attempt,
      id: socket.id,
      path: "/socket.io/",
      playerId: getStablePlayerId(),
      transport: socket.io.engine.transport.name,
      url: socketUrl,
    });
  });

  socket.io.on("reconnect_error", (error) => {
    console.log("Socket.io reconnect failure", {
      message: error.message,
      path: "/socket.io/",
      playerId: getStablePlayerId(),
      transport: socket.io.engine?.transport?.name,
      url: socketUrl,
    });
  });

  socket.io.on("reconnect_failed", () => {
    console.log("Socket.io reconnect failed", {
      path: "/socket.io/",
      playerId: getStablePlayerId(),
      transport: socket.io.engine?.transport?.name,
      url: socketUrl,
    });
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket.io disconnected", {
      id: socket.id,
      path: "/socket.io/",
      playerId: getStablePlayerId(),
      reason,
      transport: socket.io.engine?.transport?.name,
      url: socketUrl,
    });
  });

}
