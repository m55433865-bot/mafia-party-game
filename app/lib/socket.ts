import { io } from "socket.io-client";

const socketUrl =
  typeof window === "undefined" ? undefined : window.location.origin;

if (typeof window !== "undefined") {
  console.log("Socket.io connection URL", socketUrl);
}

export const socket = io(socketUrl, {
  autoConnect: false,
  transports: ["polling", "websocket"],
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
      url: socketUrl,
    });
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket.io disconnected", {
      reason,
      url: socketUrl,
    });
  });

}
