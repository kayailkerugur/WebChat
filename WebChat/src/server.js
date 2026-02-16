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

const onlineUsers = new Map();

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
  // PRESENCE: ONLINE
  // -------------------------

  onlineUsers.set(userId, socket.id);

  try {
    pool.query(
      `update users
     set is_online = true
     where id = $1`,
      [userId]
    );
  } catch (e) {
    console.error("❌ presence online update error:", e);
  }

  socket.broadcast.emit("presence:update", {
    userId,
    isOnline: true,
    lastSeen: null
  });
  // -------------------------
  // ROOM EVENTS (opsiyonel / legacy)
  // -------------------------
  socket.on("room:join", ({ roomId }) => {
    if (!roomId) return socket.emit("error", { code: "VALIDATION", message: "roomId is required" });

    socket.join(roomId);

    const presenceUser = { id: userId, username }; // presence.service.js id bekliyor olabilir
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
  // DM OPEN (DB + history + peerLastReadAt)
  // -------------------------
  socket.on("dm:open", async ({ peerId }) => {
    console.log("🔥 dm:open", { from: username, myId: userId, peerId });

    if (!peerId) {
      return socket.emit("error", { code: "VALIDATION", message: "peerId required" });
    }
    if (peerId === userId) {
      return socket.emit("error", { code: "VALIDATION", message: "cannot DM yourself" });
    }

    const key = dmKey(userId, peerId);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // peer var mı?
      const peerCheck = await client.query(`select id, username from users where id=$1`, [peerId]);
      if (!peerCheck.rowCount) {
        await client.query("ROLLBACK");
        return socket.emit("error", { code: "NOT_FOUND", message: "peer user not found" });
      }

      const peerPresence = await client.query(
        `select is_online, last_seen
   from users
   where id=$1`,
        [peerId]
      );

      const isOnline = peerPresence.rows[0]?.is_online;
      const lastSeen = peerPresence.rows[0]?.last_seen;

      // conversation var mı?
      const q = await client.query(`select id from conversations where dm_key=$1`, [key]);
      let conversationId = q.rows[0]?.id;

      // yoksa oluştur + members ekle
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
          [conversationId, userId, peerId]
        );
      }

      // history
      // history (son 50)
      const hist = await client.query(
        `select * from (
      select m.id, m.body, m.sent_at,
             u.id as sender_id, u.username
      from messages m
      join users u on u.id = m.sender_id
      where m.conversation_id = $1
      order by m.sent_at desc
      limit 50
   ) t
   order by t.sent_at asc`,
        [conversationId]
      );

      const peerRead = await client.query(
        `select last_read_at
         from conversation_members
         where conversation_id = $1
           and user_id <> $2
         limit 1`,
        [conversationId, userId]
      );
      const peerLastReadAt = peerRead.rows[0]?.last_read_at || null;

      await client.query("COMMIT");

      // room join + state emit
      socket.join(conversationId);

      socket.emit("dm:state", {
        conversationId,
        peerLastReadAt,
        presence: {
          isOnline,
          lastSeen
        },
        history: hist.rows.map(r => ({
          id: r.id,
          text: r.body,
          sentAt: r.sent_at,
          from: { userId: r.sender_id, username: r.username }
        }))
      });

      console.log("🔥 dm:state OK", { conversationId });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("❌ dm:open error:", {
        code: e.code,
        message: e.message,
        detail: e.detail
      });
      socket.emit("error", { code: "SERVER", message: "dm:open failed" });
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
      const mem = await pool.query(
        `select 1
         from conversation_members
         where conversation_id=$1 and user_id=$2`,
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

  // -------------------------
  // TYPING (conversationId-based)
  // -------------------------
  socket.on("typing:start", ({ conversationId }) => {
    if (!conversationId) return;
    if (!socket.rooms.has(conversationId)) return;

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

    socket.to(conversationId).emit("typing", {
      conversationId,
      userId,
      username,
      isTyping: false
    });
  });

  // -------------------------
  // READ (last_read_at) + broadcast
  // -------------------------
  socket.on("conversation:read", async ({ conversationId }) => {
    if (!conversationId) return;

    try {
      const mem = await pool.query(
        `select 1
       from conversation_members
       where conversation_id=$1 and user_id=$2`,
        [conversationId, userId]
      );
      if (!mem.rowCount) return;

      // ✅ DB zamanını al
      const upd = await pool.query(
        `update conversation_members
       set last_read_at = now()
       where conversation_id=$1 and user_id=$2
       returning last_read_at`,
        [conversationId, userId]
      );

      const lastReadAt = upd.rows[0]?.last_read_at;

      socket.emit("conversation:read:ok", { conversationId, lastReadAt });

      socket.to(conversationId).emit("read:updated", {
        conversationId,
        userId,
        lastReadAt
      });

    } catch (e) {
      console.error("❌ conversation:read error:", e);
      socket.emit("error", { code: "SERVER", message: "conversation:read failed" });
    }
  });

  // -------------------------
  // DISCONNECT
  // -------------------------
  socket.on("disconnect", async () => {
    console.log("❌ Disconnected:", { userId, username });

    onlineUsers.delete(userId);

    try {
      await pool.query(
        `update users
       set is_online = false,
           last_seen = now()
       where id = $1`,
        [userId]
      );
    } catch (e) {
      console.error("❌ presence offline update error:", e);
    }

    const leftRooms = removeUserFromAllRooms(userId);

    for (const roomId of leftRooms) {
      socket.to(roomId).emit("typing", {
        conversationId: roomId,
        userId,
        username,
        isTyping: false
      });
    }

    // ✅ aktif konuşmalara offline bildir
    socket.broadcast.emit("presence:update", {
      userId,
      isOnline: false,
      lastSeen: new Date().toISOString()
    });
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
