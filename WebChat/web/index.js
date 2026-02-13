let socket = null;

const statusText = document.getElementById("statusText");
const usersList = document.getElementById("users");
const logEl = document.getElementById("log");

const serverUrlEl = document.getElementById("serverUrl");
const tokenEl = document.getElementById("tokenInput");
const roomEl = document.getElementById("roomInput");

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");

const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const messagesList = document.getElementById("messages");

const typingIndicator = document.getElementById("typingIndicator");
const typingUsers = new Map();
let typingStopTimer = null;
let isTypingLocal = false;

function log(msg, data) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.textContent = line + (data ? "\n" + JSON.stringify(data, null, 2) : "") + "\n\n" + logEl.textContent;
}

function setStatus(s) {
    statusText.textContent = s;
}

function renderUsers(users) {
    usersList.innerHTML = "";
    users.forEach(addUser);
}

function addUser(user) {
    const li = document.createElement("li");
    li.id = user.id;
    li.textContent = `${user.username} (${user.id})`;
    usersList.appendChild(li);
}

function removeUser(userId) {
    const li = document.getElementById(userId);
    if (li) li.remove();
}

function enableConnectedUI(enabled) {
    disconnectBtn.disabled = !enabled;
    joinBtn.disabled = !enabled;
    connectBtn.disabled = enabled;
}

function enableInRoomUI(inRoom) {
    leaveBtn.disabled = !inRoom;
}

function cleanupSocket() {
    if (!socket) return;
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
}

function enableInRoomUI(inRoom) {
    leaveBtn.disabled = !inRoom;
    sendBtn.disabled = !inRoom;
}

connectBtn.addEventListener("click", () => {
    const url = serverUrlEl.value.trim();
    let token = tokenEl.value.trim();

    if (!url) {
        alert("Server URL boş olamaz.");
        return;
    }
    if (!token) {
        alert("Token girmen lazım.");
        return;
    }
    if (token.startsWith("Bearer ")) token = token.slice(7);

    cleanupSocket();

    socket = io(url, {
        auth: { token },
        transports: ["websocket", "polling"]
    });

    setStatus("CONNECTING...");
    log("Connecting...", { url });

    socket.on("connect", () => {
        setStatus("CONNECTED");
        enableConnectedUI(true);
        enableInRoomUI(false);
        renderUsers([]);
        log("Connected", { socketId: socket.id });
    });

    socket.on("connect_error", (err) => {
        setStatus("DISCONNECTED");
        enableConnectedUI(false);
        enableInRoomUI(false);
        log("Connect error", { message: err.message });
    });

    socket.on("disconnect", (reason) => {
        setStatus("DISCONNECTED");
        enableConnectedUI(false);
        enableInRoomUI(false);
        log("Disconnected", { reason });
    });

    socket.on("room:state", (data) => {
        log("room:state", data);
        renderUsers(data.users || []);
        enableInRoomUI(true);

        // ✅ Eski mesajları bas
        messagesList.innerHTML = "";
        (data.history || []).forEach((msg) => {
            const li = document.createElement("li");
            li.textContent = `${msg.from.username}: ${msg.text}`;
            messagesList.appendChild(li);
        });
    });

    socket.on("room:user-joined", (data) => {
        log("room:user-joined", data);
        if (data?.user) addUser(data.user);
    });

    socket.on("room:user-left", (data) => {
        log("room:user-left", data);
        if (data?.userId) removeUser(data.userId);
    });

    socket.on("error", (err) => {
        log("server:error", err);
    });

    socket.on("message:new", (data) => {
        log("message:new", data);

        const msg = data?.message;
        if (!msg) return;

        const li = document.createElement("li");
        li.textContent = `${msg.from.username}: ${msg.text}`;
        messagesList.appendChild(li);
    });

    socket.on("typing", (data) => {
        const { userId, username, isTyping } = data || {};
        if (!userId) return;

        if (isTyping) typingUsers.set(userId, username || userId);
        else typingUsers.delete(userId);

        renderTypingIndicator();
    });
});


function renderTypingIndicator() {
    const names = Array.from(typingUsers.values());
    if (names.length === 0) {
        typingIndicator.textContent = "";
        return;
    }
    if (names.length === 1) {
        typingIndicator.textContent = `${names[0]} yazıyor...`;
        return;
    }
    typingIndicator.textContent = `${names.slice(0, 2).join(", ")}${names.length > 2 ? " ve diğerleri" : ""} yazıyor...`;
}

disconnectBtn.addEventListener("click", () => {
    cleanupSocket();
    setStatus("DISCONNECTED");
    enableConnectedUI(false);
    enableInRoomUI(false);
    renderUsers([]);
    typingUsers.clear();
    typingIndicator.textContent = "";
    isTypingLocal = false;
    log("Manual disconnect");
});

joinBtn.addEventListener("click", () => {
    if (!socket || !socket.connected) {
        alert("Önce connect ol.");
        return;
    }
    const roomId = roomEl.value.trim();
    if (!roomId) {
        alert("roomId boş olamaz.");
        return;
    }
    socket.emit("room:join", { roomId });

    messagesList.innerHTML = "";

    log("Emit room:join", { roomId });
});

leaveBtn.addEventListener("click", () => {
    if (!socket || !socket.connected) return;
    const roomId = roomEl.value.trim();
    if (!roomId) return;
    socket.emit("room:leave", { roomId });
    enableInRoomUI(false);
    renderUsers([]);
    messagesList.innerHTML = "";
    typingUsers.clear();
    typingIndicator.textContent = "";
    isTypingLocal = false;
    log("Emit room:leave", { roomId });
});

sendBtn.addEventListener("click", () => {
    if (!socket || !socket.connected) return;

    if (isTypingLocal) {
        isTypingLocal = false;
        socket.emit("typing:stop", { roomId });
    }

    const roomId = roomEl.value.trim();
    const text = messageInput.value.trim();

    if (!text) return;

    socket.emit("message:send", { roomId, text });
    messageInput.value = "";
    console.log({ messageInput, sendBtn, messagesList });
});

messageInput.addEventListener("input", () => {
    if (!socket || !socket.connected) return;
    const roomId = roomEl.value.trim();
    if (!roomId) return;

    // ilk kez yazmaya başladıysa start gönder
    if (!isTypingLocal) {
        isTypingLocal = true;
        socket.emit("typing:start", { roomId });
    }

    // her inputta stop timer'ı resetle
    if (typingStopTimer) clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(() => {
        isTypingLocal = false;
        socket.emit("typing:stop", { roomId });
    }, 800); // 800ms yazmazsa stop
});