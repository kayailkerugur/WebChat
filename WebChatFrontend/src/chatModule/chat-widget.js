function initChatWidget() {
  const API_BASE = "http://localhost:3000";

  const root = document.getElementById("cw");
  if (!root) return;
  if (root.dataset.initialized === "true") return;
  root.dataset.initialized = "true";

  // DOM
  const fab = document.getElementById("cwFab");
  const peoplePanel = document.getElementById("cwPeople");
  const chatPanel = document.getElementById("cwChat");
  const closePeople = document.getElementById("cwClosePeople");
  const closeChat = document.getElementById("cwCloseChat");
  const backBtn = document.getElementById("cwBack");
  const list = document.getElementById("cwList");
  const search = document.getElementById("cwSearch");
  const nameEl = document.getElementById("cwName");
  const avatarEl = document.getElementById("cwAvatar");
  const subEl = document.getElementById("cwSub");
  const messagesEl = document.getElementById("cwMessages");
  const form = document.getElementById("cwForm");
  const textInput = document.getElementById("cwText");

  const required = { fab, peoplePanel, chatPanel, closePeople, closeChat, backBtn, list, search, nameEl, avatarEl, subEl, messagesEl, form, textInput };
  const missing = Object.entries(required).filter(([_, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error("[chat-widget] Eksik elementler:", missing);
    return;
  }

  // Auth
  const token = localStorage.getItem("jwt_token");
  const me = JSON.parse(localStorage.getItem("me_user") || "null");
  const myId = me?.id || me?.userId;

  if (!token || !me || !myId) {
    console.warn("jwt_token / me_user yok. Önce select-user.html ile login ol.");
    return;
  }

  // State
  let INBOX = [];              // {conversationId, peerId, peerUsername, lastMessage, lastSentAt, unreadCount}
  let USER_RESULTS = [];       // {id, username}
  let searchMode = "inbox";    // "inbox" | "users"

  let currentPeerId = null;
  let currentConversationId = null;

  let peerLastReadAt = null;
  let currentHistory = [];
  let historyIds = new Set();  

  let socket = null;

  // typing
  let typingTimer = null;
  let isTyping = false;
  let typingClearTimer = null;

  // Helpers
  function initials(name) {
    return String(name || "").slice(0, 2).toUpperCase();
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  }

  // Panels
  function openPeople() {
    chatPanel.classList.remove("open");
    chatPanel.setAttribute("aria-hidden", "true");

    peoplePanel.classList.add("open");
    peoplePanel.setAttribute("aria-hidden", "false");

    subEl.textContent = "";
    search.value = "";
    searchMode = "inbox";

    loadConversations()
      .then(() => renderInbox(""))
      .catch(err => {
        console.error(err);
        list.innerHTML = `<div style="padding:12px;opacity:.7">Konuşmalar yüklenemedi</div>`;
      });

    setTimeout(() => search.focus(), 0);
  }

  function closeAll() {
    peoplePanel.classList.remove("open");
    peoplePanel.setAttribute("aria-hidden", "true");
    chatPanel.classList.remove("open");
    chatPanel.setAttribute("aria-hidden", "true");

    // typing stop
    if (socket && currentConversationId && isTyping) {
      isTyping = false;
      clearTimeout(typingTimer);
      socket.emit("typing:stop", { conversationId: currentConversationId });
    }

    clearTimeout(typingClearTimer);
    subEl.textContent = "";
  }

  // Inbox render
  function renderInbox(q) {
    const query = (q || "").toLowerCase().trim();
    const filtered = INBOX.filter(c => (c.peerUsername || "").toLowerCase().includes(query));

    if (!filtered.length) {
      list.innerHTML = `<div style="padding:12px;opacity:.7">Henüz konuşma yok</div>`;
      return;
    }

    list.innerHTML = filtered.map(c => `
      <button class="cw-item" data-peer="${c.peerId}">
        <div class="cw-av">${initials(c.peerUsername)}</div>

        <div class="cw-meta">
          <div class="cw-top">
            <div class="n">${escapeHtml(c.peerUsername)}</div>
            ${c.unreadCount > 0 ? `<span class="cw-badge">${c.unreadCount}</span>` : ""}
          </div>
          <div class="p">${escapeHtml(c.lastMessage || "")}</div>
        </div>

        <div class="cw-time">${fmtTime(c.lastSentAt)}</div>
      </button>
    `).join("");

    list.querySelectorAll(".cw-item").forEach(btn => {
      btn.addEventListener("click", () => openChatFromInbox(btn.dataset.peer));
    });
  }

  // Search Users UI
  async function searchUsers(q) {
    const res = await fetch(`${API_BASE}/users/search?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("user search failed");

    const data = await res.json();
    USER_RESULTS = (data.users || []).filter(u => u.id !== myId); // kendini gösterme
    renderUserResults(USER_RESULTS);
  }

  function renderUserResults(arr) {
    if (!arr.length) {
      list.innerHTML = `<div style="padding:12px;opacity:.7">Kullanıcı bulunamadı</div>`;
      return;
    }

    list.innerHTML = arr.map(u => `
      <button class="cw-item" data-peer="${u.id}" data-username="${escapeHtml(u.username)}">
        <div class="cw-av">${initials(u.username)}</div>
        <div class="cw-meta">
          <div class="n">${escapeHtml(u.username)}</div>
          <div class="p">Yeni sohbet başlat</div>
        </div>
      </button>
    `).join("");

    list.querySelectorAll(".cw-item").forEach(btn => {
      btn.addEventListener("click", () => openChatNew(btn.dataset.peer, btn.dataset.username));
    });
  }

  // Read receipt helpers
  function isReadByPeer(msg) {
    if (!peerLastReadAt) return false;
    if (msg?.from?.userId !== myId) return false;

    const sent = new Date(msg.sentAt).getTime();
    const read = new Date(peerLastReadAt).getTime();
    return sent <= read;
  }

  // Messages render
  function appendMessage(msg) {
    const div = document.createElement("div");
    const isMe = msg?.from?.userId === myId;

    div.className = `cw-msg ${isMe ? "me" : "them"}`;

    const text = document.createElement("span");
    text.className = "cw-text";
    text.textContent = msg?.text ?? "";
    div.appendChild(text);

    if (isMe) {
      const meta = document.createElement("span");
      meta.className = "cw-meta2";

      const ticks = document.createElement("span");
      ticks.className = "cw-ticks";              
      ticks.dataset.sentAt = msg.sentAt || "";   

      ticks.innerHTML = `
      <span class="tick t1">✓</span>
      <span class="tick t2">✓</span>
    `;

      meta.appendChild(ticks);
      div.appendChild(meta);
    }

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateReadTicks() {
    const readAt = peerLastReadAt ? new Date(peerLastReadAt).getTime() : 0;

    document.querySelectorAll("#cwMessages .cw-ticks").forEach(el => {
      const sentAt = el.dataset.sentAt ? new Date(el.dataset.sentAt).getTime() : 0;

      if (readAt && sentAt && sentAt <= readAt) el.classList.add("read");
      else el.classList.remove("read");
    });
  }

  function renderHistory(history) {
    messagesEl.innerHTML = "";
    historyIds = new Set();
    (history || []).forEach(appendMessage);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // API: conversations
  async function loadConversations() {
    const res = await fetch(`${API_BASE}/conversations`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("conversations fetch failed");
    const data = await res.json();
    INBOX = data.conversations || [];
    renderInbox(search.value);
  }

  // Open chats
  function openChatUI(peerUsername) {
    nameEl.textContent = peerUsername || "Kullanıcı";
    avatarEl.textContent = initials(peerUsername || "U");
    subEl.textContent = "";

    peoplePanel.classList.remove("open");
    peoplePanel.setAttribute("aria-hidden", "true");

    chatPanel.classList.add("open");
    chatPanel.setAttribute("aria-hidden", "false");

    messagesEl.innerHTML = `<div class="cw-msg them">Yükleniyor...</div>`;
  }

  function resetChatStateBeforeOpen(peerId) {
    currentPeerId = peerId;
    currentConversationId = null;
    peerLastReadAt = null;
    currentHistory = [];
    historyIds = new Set();
    clearTimeout(typingClearTimer);
    subEl.textContent = "";
  }

  function openChatFromInbox(peerId) {
    const c = INBOX.find(x => x.peerId === peerId);
    if (!c) return;

    resetChatStateBeforeOpen(peerId);
    openChatUI(c.peerUsername);

    socket.emit("dm:open", { peerId });
  }

  function openChatNew(peerId, peerUsername) {
    resetChatStateBeforeOpen(peerId);
    openChatUI(peerUsername);

    socket.emit("dm:open", { peerId });
  }

  // Socket connect
  function connectSocket() {
    socket = io(API_BASE, {
      transports: ["websocket"],
      auth: { token }
    });

    socket.on("connect", () => console.log("✅ socket connected", socket.id));
    socket.on("disconnect", () => console.log("❌ socket disconnected"));
    socket.on("error", (e) => console.log("ERR:", e));

    // read ok → inbox refresh
    socket.on("conversation:read:ok", () => loadConversations().catch(console.error));

    // dm state
    socket.on("dm:state", ({ conversationId, history, peerLastReadAt: pla }) => {
      currentConversationId = conversationId;
      peerLastReadAt = pla || null;

      currentHistory = history || [];
      renderHistory(currentHistory);

      updateReadTicks(); // ✅

      socket.emit("conversation:read", { conversationId });

      console.log("DM STATE peerLastReadAt:", peerLastReadAt);
      console.log("HISTORY last sentAt:", currentHistory?.[currentHistory.length - 1]?.sentAt);
    });

    // new message
    socket.on("message:new", ({ conversationId, message }) => {
      if (conversationId !== currentConversationId) return;

      currentHistory.push(message);
      appendMessage(message);

      const fromId = message?.from?.userId;
      if (fromId && fromId !== myId) {
        socket.emit("conversation:read", { conversationId });
      }
    });

    socket.on("read:updated", (p) => {
      console.log("READ UPDATED:", p); // debug

      const { conversationId, userId, lastReadAt } = p || {};
      if (conversationId !== currentConversationId) return;

      if (userId !== myId) {
        peerLastReadAt = lastReadAt;
        updateReadTicks(); 
      }
    });

    let typingClearTimer = null;
    socket.on("typing", ({ conversationId, username, isTyping }) => {
      if (conversationId !== currentConversationId) return;

      if (isTyping) {
        subEl.textContent = `${username} yazıyor...`;
        clearTimeout(typingClearTimer);
        typingClearTimer = setTimeout(() => {
          subEl.textContent = "";
        }, 2000);
      } else {
        subEl.textContent = "";
      }
    });
  }

  // Submit message
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const value = textInput.value.trim();
    if (!value) return;
    if (!socket || !currentConversationId) return;

    // typing stop
    if (isTyping) {
      isTyping = false;
      clearTimeout(typingTimer);
      socket.emit("typing:stop", { conversationId: currentConversationId });
    }

    socket.emit("message:send", { conversationId: currentConversationId, text: value });
    textInput.value = "";
  });

  // Typing emit
  textInput.addEventListener("input", () => {
    if (!socket || !currentConversationId) return;

    if (!isTyping) {
      isTyping = true;
      socket.emit("typing:start", { conversationId: currentConversationId });
    }

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (!isTyping) return;
      isTyping = false;
      socket.emit("typing:stop", { conversationId: currentConversationId });
    }, 600);
  });

  // Search behavior (inbox filter vs user search)
  let searchTimer = null;
  search.addEventListener("input", (e) => {
    const q = e.target.value.trim();

    if (!q) {
      searchMode = "inbox";
      renderInbox("");
      return;
    }

    searchMode = "users";
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchUsers(q).catch(console.error);
    }, 250);
  });

  // Click handling
  root.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", closeAll);

  fab.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = peoplePanel.classList.contains("open") || chatPanel.classList.contains("open");
    if (isOpen) closeAll();
    else openPeople();
  });

  closePeople.addEventListener("click", (e) => { e.stopPropagation(); closeAll(); });
  closeChat.addEventListener("click", (e) => { e.stopPropagation(); closeAll(); });
  backBtn.addEventListener("click", (e) => { e.stopPropagation(); openPeople(); });

  // start
  connectSocket();
  loadConversations().catch(console.error);
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("cw")) initChatWidget();
});