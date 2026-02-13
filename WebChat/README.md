# WebChat (Realtime Chat Server with JWT + Rooms)

A production-structured realtime chat server built with:

- Node.js
- Express
- Socket.io
- JWT Authentication
- Room-based messaging
- Typing indicator
- Basic anti-spam protection

---

## 🚀 Features

### 🔐 Authentication
- JWT-based socket handshake authentication
- Token verified during connection
- Unauthorized users rejected

### 🏠 Room System
- Join / Leave rooms
- Online users list per room
- Room state sync on join

### 💬 Messaging
- Realtime message broadcast
- Room-based message isolation
- Message history stored in-memory
- Auto-scroll client UI

### ⌨️ Typing Indicator
- typing:start
- typing:stop
- Debounced client events
- Server-side anti-spam cooldown (300ms)

### 🛡 Anti-Spam
- Typing event cooldown
- Room membership validation before emit

---

## 📂 Project Structure

src/
 ├── config/
 │   └── env.js
 ├── services/
 │   └── message.service.js
 │   └── presence.service.js
 ├── middleware/
 │   └── socketAuth.js
 ├── server.js
web/
 ├── index.html
 ├── index.js
 ├── generate-token.js
 ├── token-generator.html
 └── index.css

---

## ⚙️ Installation

```bash
npm install
```

Create a `.env` file:

```
PORT=3000
JWT_SECRET=your_super_secret_key_here
CORS_ORIGIN=http://127.0.0.1:5500
MESSAGE_HISTORY_LIMIT=50
RATE_LIMIT_WINDOW_MS=10000
RATE_LIMIT_MAX=20
NODE_ENV=development
```

Run the server:

```bash
npm run dev
```

---

## 🔑 Generate Token (Dev Only)

```bash
node generate-token.js user-1 Kaya
```

Copy the generated token into the test client.

---

## 🌐 Test Client

Open:

```
web/index.html
```

Steps:
1. Paste token
2. Connect
3. Join a room
4. Send messages

Open the same HTML in two browser tabs with different tokens to test realtime behavior.

---

## 🔌 Socket Events

### Client → Server

room:join       { roomId }
room:leave      { roomId }
message:send    { roomId, text }
typing:start    { roomId }
typing:stop     { roomId }

### Server → Client

room:state        { roomId, users, history }
room:user-joined  { roomId, user }
room:user-left    { roomId, userId }
message:new       { roomId, message }
typing            { roomId, userId, username, isTyping }

---

## 🧠 Future Improvements

- Redis adapter for horizontal scaling
- Persistent message storage (PostgreSQL / MongoDB)
- Global rate limiting middleware
- Private messaging
- File/image upload
- Message read receipts
- Role-based rooms (admin/moderator)

---

## 🛠 Tech Stack

- Node.js
- Express
- Socket.io
- JSON Web Token
- Vanilla JS Test Client

---

## 🧑‍💻 Author

Built by Kaya

## 📄 License

MIT License