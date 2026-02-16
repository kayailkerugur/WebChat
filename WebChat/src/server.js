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

const { healthcheck } = require("./db/db");

const { pool } = require("./db/db");

const io = new Server(server, {
  cors: {
    origin: env.corsOrigin,
    methods: ["GET", "POST"],
  },
});

const typingLastSent = new Map();

io.use(socketAuthMiddleware);

io.on("connection", (socket) => {
  // ✅ Normalize user (JWT payload: { userId, username })
  const u = socket.data.user || {};
  const userId = u.userId || u.id;        
  const username = u.username;

  if (!userId || !username) {
    console.error("❌ Invalid socket user payload:", u);
    socket.emit("error", { code: "AUTH", message: "invalid user payload" });
    socket.disconnect(true);
    return;
  }

  console.log("✅ Connected:", { userId, username });

  // -------------------------
  // ROOM EVENTS (opsiyonel)
  // -------------------------
  socket.on("room:join", ({ roomId }) => {
    if (!roomId) return socket.emit("error", { code: "VALIDATION", message: "roomId is required" });

    socket.join(roomId);

    const presenceUser = { userId, username };
    const users = joinRoom(roomId, presenceUser);
    const history = getRoomHistory(roomId);

    socket.emit("room:state", { roomId, users, history });
    socket.to(roomId).emit("room:user-joined", { roomId, user: presenceUser });
  });

  socket.on("room:leave", ({ roomId }) => {
    if (!roomId) return;

    socket.leave(roomId);
    leaveRoom(roomId, userId);

    socket.to(roomId).emit("room:user-left", { roomId, userId });
  });

  // -------------------------
  // DM OPEN (DB + history)
  // -------------------------
  socket.on("dm:open", async ({ peerId }) => {
    const u = socket.data.user || {};
    const myId = u.userId || u.id;
    const myUsername = u.username;

    console.log("🔥 dm:open", { from: myUsername, myId, peerId });

    if (!myId) {
      return socket.emit("error", { code: "AUTH", message: "missing myId in token" });
    }
    if (!peerId) {
      return socket.emit("error", { code: "VALIDATION", message: "peerId required" });
    }
    if (peerId === myId) {
      return socket.emit("error", { code: "VALIDATION", message: "cannot DM yourself" });
    }

    const key = dmKey(myId, peerId);

    const client = await pool.connect();
    try {
      await client.query("begin");

      const peerCheck = await client.query(`select id, username from users where id=$1`, [peerId]);
      if (!peerCheck.rowCount) {
        await client.query("rollback");
        return socket.emit("error", { code: "NOT_FOUND", message: "peer user not found" });
      }

      const q = await client.query(`select id from conversations where dm_key=$1`, [key]);
      let conversationId = q.rows[0]?.id;

      if (!conversationId) {
        const ins = await client.query(
          `insert into conversations (type, dm_key)
         values ('DM', $1)
         returning id`,
          [key]
        );
        conversationId = ins.rows[0].id;

        await client.query(
          `insert into conversation_members (conversation_id, user_id)
         values ($1,$2),($1,$3)`,
          [conversationId, myId, peerId]
        );
      }

      const hist = await client.query(
        `select m.id, m.body, m.sent_at,
              u.id as sender_id, u.username
       from messages m
       join users u on u.id = m.sender_id
       where m.conversation_id = $1
       order by m.sent_at asc
       limit 50`,
        [conversationId]
      );

      await client.query("commit");

      socket.join(conversationId);

      socket.emit("dm:state", {
        conversationId,
        history: hist.rows.map(r => ({
          id: r.id,
          text: r.body,
          sentAt: r.sent_at,
          from: { userId: r.sender_id, username: r.username }
        }))
      });

      console.log("🔥 dm:state OK", { conversationId });

    } catch (e) {
      await client.query("rollback");
      console.error("❌ dm:open error:", {
        code: e.code,
        message: e.message,
        detail: e.detail
      });

      socket.emit("error", {
        code: "SERVER",
        message: "dm:open failed"
      });
    } finally {
      client.release();
    }
  });

  // -------------------------
  // MESSAGE SEND (conversationId)
  // -------------------------
  socket.on("message:send", async ({ conversationId, text }) => {
    if (!conversationId || !text?.trim()) {
      return socket.emit("error", { code: "VALIDATION", message: "conversationId and text required" });
    }

    try {
      // üyelik kontrolü
      const mem = await pool.query(
        `select 1 from conversation_members where conversation_id=$1 and user_id=$2`,
        [conversationId, userId]
      );
      if (!mem.rowCount) {
        return socket.emit("error", { code: "FORBIDDEN", message: "not a member" });
      }

      const ins = await pool.query(
        `insert into messages (conversation_id, sender_id, body)
         values ($1,$2,$3)
         returning id, sent_at`,
        [conversationId, userId, text.trim()]
      );

      const message = {
        id: ins.rows[0].id,
        conversationId,
        text: text.trim(),
        sentAt: ins.rows[0].sent_at,
        from: { userId, username }
      };

      io.to(conversationId).emit("message:new", { conversationId, message });

    } catch (e) {
      console.error("❌ message:send error:", e);
      socket.emit("error", { code: "SERVER", message: "message:send failed" });
    }
  });

  socket.on("typing:start", ({ conversationId }) => {
    if (!conversationId) return;
    if (!socket.rooms.has(conversationId)) return;
    if (!canSendTyping(conversationId)) return;

    socket.to(conversationId).emit("typing", {
      conversationId,
      userId,
      username,
      isTyping: true
    });
  });

  socket.on("typing:stop", ({ conversationId }) => {
    if (!conversationId) return;
    if (!socket.rooms.has(conversationId)) return;
    if (!canSendTyping(conversationId)) return;

    socket.to(conversationId).emit("typing", {
      conversationId,
      userId,
      username,
      isTyping: false
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", { userId, username });

    const leftRooms = removeUserFromAllRooms(userId);

    for (const roomId of leftRooms) {
      socket.to(roomId).emit("typing", {
        roomId,
        userId,
        username,
        isTyping: false
      });
    }
  });
});

function dmKey(a, b) {
  const [x, y] = [a, b].sort();
  return `dm:${x}:${y}`;
}


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

function canSendTyping(roomId) {
  const key = roomId;
  const now = Date.now();
  const last = typingLastSent.get(key) || 0;

  if (now - last < 300) return false;

  typingLastSent.set(key, now);
  return true;
}

app.get("/health/db", async (req, res) => {
  try {
    const ok = await healthcheck();
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use("/auth", require("./routes/auth.routes"));

app.use("/", require("./routes/users.routes"));

app.use("/", require("./routes/conversations.routes"));

module.exports = { io };
