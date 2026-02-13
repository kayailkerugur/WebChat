const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const env = require("./config/env");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const { joinRoom, leaveRoom, listUsers, removeUserFromAllRooms } =
  require("./services/presence.service");
const { getRoomHistory } = require("./services/message.service");

const socketAuthMiddleware = require("./middleware/socketAuth");

const { appendMessage } = require("./services/message.service");

const crypto = require("crypto");

const io = new Server(server, {
  cors: {
    origin: env.corsOrigin,
    methods: ["GET", "POST"],
  },
});

const typingLastSent = new Map();

io.use(socketAuthMiddleware);

io.on("connection", (socket) => {
  const user = socket.data.user;
  console.log("✅ Connected:", user);

  socket.on("room:join", ({ roomId }) => {
    if (!roomId) return socket.emit("error", { code: "VALIDATION", message: "roomId is required" });

    socket.join(roomId);

    const users = joinRoom(roomId, user);
    const history = getRoomHistory(roomId);

    socket.emit("room:state", { roomId, users, history });

    socket.to(roomId).emit("room:user-joined", { roomId, user });
  });

  socket.on("room:leave", ({ roomId }) => {
    if (!roomId) return;

    socket.leave(roomId);
    leaveRoom(roomId, user.id);

    socket.to(roomId).emit("room:user-left", { roomId, userId: user.id });
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", user);

    const leftRooms = removeUserFromAllRooms(user.id);

    typingLastSent.clear();
    
    for (const roomId of leftRooms) {
      socket.to(roomId).emit("typing", {
        roomId,
        userId: user.id,
        username: user.username,
        isTyping: false
      });
    }
  });

  socket.on("connect", () => {
    console.log("Connected:", socket.id);
    socket.emit("room:join", { roomId: "room-1" });
  });

  socket.on("room:state", (data) => console.log("room:state", data));
  socket.on("room:user-joined", (data) => console.log("joined", data));
  socket.on("room:user-left", (data) => console.log("left", data));
  socket.on("error", (e) => console.log("ERR:", e));

  socket.on("message:send", ({ roomId, text }) => {
    if (!roomId || !text) {
      return socket.emit("error", {
        code: "VALIDATION",
        message: "roomId and text required"
      });
    }

    const message = {
      id: crypto.randomUUID(),
      roomId,
      from: socket.data.user,
      text: text.trim(),
      sentAt: new Date().toISOString()
    };

    appendMessage(roomId, message);

    io.to(roomId).emit("message:new", { roomId, message });
  });

  socket.on("message:new", (data) => {
    const msg = data.message;
    const li = document.createElement("li");
    li.textContent = `${msg.from.username}: ${msg.text}`;
    messagesList.appendChild(li);
  });

  socket.on("room:state", (data) => {
    log("room:state", data);
    renderUsers(data.users || []);
    enableInRoomUI(true);

    messagesList.innerHTML = "";
    (data.history || []).forEach(msg => {
      const li = document.createElement("li");
      li.textContent = `${msg.from.username}: ${msg.text}`;
      messagesList.appendChild(li);
    });
  });

  socket.on("typing:start", ({ roomId }) => {
    if (!roomId) return;

    if (!socket.rooms.has(roomId)) {
      return socket.emit("error", { code: "NOT_IN_ROOM", message: "Join room first" });
    }

    if (!canSendTyping(roomId)) return;

    socket.to(roomId).emit("typing", {
      roomId,
      userId: socket.data.user.id,
      username: socket.data.user.username,
      isTyping: true
    });
  });

  socket.on("typing:stop", ({ roomId }) => {
    if (!roomId) return;

    if (!socket.rooms.has(roomId)) return;

    if (!canSendTyping(roomId)) return;

    socket.to(roomId).emit("typing", {
      roomId,
      userId: socket.data.user.id,
      username: socket.data.user.username,
      isTyping: false
    });
  });
});

app.use(cors({
  origin: [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://localhost:5173"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false
}));

app.use(express.json());

app.post("/dev/token", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ message: "Not allowed in production" });
  }

  const { userId, username } = req.body;

  if (!userId || !username) {
    return res.status(400).json({ message: "userId and username required" });
  }

  const token = jwt.sign(
    { userId, username },
    env.jwtSecret,
    { expiresIn: "1h" }
  );

  res.json({ token });
});

app.use(require("cors")({
  origin: "*"
}));

server.listen(env.port, () => {
  console.log(`🚀 Server running on port ${env.port}`);
});

module.exports = { io };

function canSendTyping(roomId) {
  const key = roomId;
  const now = Date.now();
  const last = typingLastSent.get(key) || 0;

  if (now - last < 300) return false;

  typingLastSent.set(key, now);
  return true;
}