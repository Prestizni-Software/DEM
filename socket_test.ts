import { Server as SocketServer } from "socket.io";
import { Server } from "node:http";
import { io } from "socket.io-client";

const server = new Server();
  server.listen(3002);
  const ss = new SocketServer(server, { cors: { origin: "*" } });

  ss.on("connection", (socket) => {
    console.log("a user connected");
    socket.on("disconnect", () => {
      console.log("user disconnected");
    });
    socket.onAny((event) => {
      console.log("Server1: " + event);
    });
  });

  const client1 = io("http://localhost:3002");
  client1.onAny((event) => console.log("Client1: " + event));
  const client2 = io("http://localhost:3002");
  client2.emit("test", "test");
  console.log("test");