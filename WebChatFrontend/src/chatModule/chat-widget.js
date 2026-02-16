function initChatWidget() {
  const API_BASE = "http://localhost:3000";

  const root = document.getElementById("cw");
  if (!root) return;
  if (root.dataset.initialized === "true") return;
  root.dataset.initialized = "true";

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

  let token = localStorage.getItem("jwt_token");
  let me = JSON.parse(localStorage.getItem("me_user") || "null");
  let INBOX = []; // {conversationId, peerId, peerUsername, lastMessage, lastSentAt}
  let currentPeerId = null; // kalabilir, istersen kaldırırız
  let currentConversationId = null;
  let socket = null;

  function initials(name) {
    return String(name || "").slice(0, 2).toUpperCase();
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  function openPeople() {
    chatPanel.classList.remove("open");
    chatPanel.setAttribute("aria-hidden", "true");

    peoplePanel.classList.add("open");
    peoplePanel.setAttribute("aria-hidden", "false");

    search.value = "";
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
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  }

  function renderInbox(q) {
    const query = (q || "").toLowerCase().trim();
    const filtered = INBOX.filter(c => (c.peerUsername || "").toLowerCase().includes(query));

    list.innerHTML = filtered.map(c => `
    <button class="cw-item" data-peer="${c.peerId}">
      <div class="cw-av">${initials(c.peerUsername)}</div>
      <div class="cw-meta">
        <div class="n">${escapeHtml(c.peerUsername)}</div>
        <div class="p">${escapeHtml(c.lastMessage || "")}</div>
      </div>
      <div style="margin-left:auto;font-size:12px;opacity:.65;">
        ${fmtTime(c.lastSentAt)}
      </div>
    </button>
  `).join("");

    list.querySelectorAll(".cw-item").forEach(btn => {
      btn.addEventListener("click", () => openChat(btn.dataset.peer));
    });
  }

  function appendMessage(msg) {
    const div = document.createElement("div");
    const myId = me?.id || me?.userId;
    const isMe = msg?.from?.userId === myId;
    div.className = `cw-msg ${isMe ? "me" : "them"}`;
    div.textContent = msg?.text ?? "";
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderHistory(history) {
    messagesEl.innerHTML = "";
    (history || []).forEach(appendMessage);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function loadConversations() {
    const res = await fetch(`${API_BASE}/conversations`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("conversations fetch failed");
    const data = await res.json();
    INBOX = data.conversations || [];
    renderInbox(search.value);
  }

  function connectSocket() {
    if (!token) return;

    socket = io(API_BASE, {
      transports: ["websocket"],
      auth: { token }
    });

    socket.on("connect", () => console.log("✅ socket connected", socket.id));
    socket.on("disconnect", () => console.log("❌ socket disconnected"));
    socket.on("error", (e) => console.log("ERR:", e));

    socket.on("message:new", ({ conversationId, message }) => {
      if (conversationId !== currentConversationId) return;
      appendMessage(message);
    });
  }

  function openChat(peerId) {
    const c = INBOX.find(x => x.peerId === peerId);
    if (!c) return;

    currentPeerId = peerId;

    nameEl.textContent = c.peerUsername;
    avatarEl.textContent = initials(c.peerUsername);
    subEl.textContent = "";

    peoplePanel.classList.remove("open");
    peoplePanel.setAttribute("aria-hidden", "true");

    chatPanel.classList.add("open");
    chatPanel.setAttribute("aria-hidden", "false");

    messagesEl.innerHTML = `<div class="cw-msg them">Yükleniyor...</div>`;

    socket.emit("dm:open", { peerId });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = textInput.value.trim();
    if (!value) return;
    if (!currentConversationId) {
      return;
    }
    socket.emit("message:send", { conversationId: currentConversationId, text: value });
    textInput.value = "";
  });

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
  search.addEventListener("input", (e) => renderInbox(e.target.value));
  function wireDmState() {
    socket.on("dm:state", ({ conversationId, history }) => {
      currentConversationId = conversationId;
      renderHistory(history || []);
    });
  }

  if (!token) {
    console.warn("jwt_token yok. Önce select-user.html ile login ol.");
    return;
  }

  connectSocket();
  wireDmState();
  loadConversations().catch(err => console.error(err));
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("cw")) initChatWidget();
});