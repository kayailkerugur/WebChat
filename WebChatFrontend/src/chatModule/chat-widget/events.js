// src/chatModule/events.js
import { loadConversations, searchUsersApi } from "./api.js";
import { renderInbox, renderUserResults } from "./render/inbox.js";
import { renderPresence } from "./render/presence.js";
import { closeCtxMenu } from "./render/contextMenu.js";
import { resetChatStateBeforeOpen } from "./state.js";
import { encryptMessage } from "./crypto/encryption.js";
import { ensureConversationKeyFor } from "./e2eeKey.js";

// UI helpers
function openChatUI(state, peerUsername) {
  const { nameEl, avatarEl, subEl, peoplePanel, chatPanel, messagesEl } = state.els;

  nameEl.textContent = peerUsername || "Kullanıcı";
  avatarEl.textContent = String(peerUsername || "U").slice(0, 2).toUpperCase();
  subEl.textContent = "";

  peoplePanel.classList.remove("open");
  peoplePanel.setAttribute("aria-hidden", "true");

  chatPanel.classList.add("open");
  chatPanel.setAttribute("aria-hidden", "false");

  messagesEl.innerHTML = `<div class="cw-msg them">Yükleniyor...</div>`;
}

async function openPeople(state) {
  const { peoplePanel, chatPanel, subEl, search } = state.els;

  chatPanel.classList.remove("open");
  chatPanel.setAttribute("aria-hidden", "true");

  peoplePanel.classList.add("open");
  peoplePanel.setAttribute("aria-hidden", "false");

  subEl.textContent = "";
  search.value = "";
  state.searchMode = "inbox";

  try {
    await loadConversations(state);
    renderInbox(state, "");
  } catch (err) {
    console.error(err);
    state.els.list.innerHTML = `<div style="padding:12px;opacity:.7">Konuşmalar yüklenemedi</div>`;
  }

  // inbox click bind
  bindListClicks(state);

  setTimeout(() => search.focus(), 0);
}

function closeAll(state) {
  const { peoplePanel, chatPanel, subEl } = state.els;

  peoplePanel.classList.remove("open");
  peoplePanel.setAttribute("aria-hidden", "true");
  chatPanel.classList.remove("open");
  chatPanel.setAttribute("aria-hidden", "true");

  // typing stop
  if (state.socket && state.currentConversationId && state.isTyping) {
    state.isTyping = false;
    clearTimeout(state.typingTimer);
    state.socket.emit("typing:stop", { conversationId: state.currentConversationId });
  }

  clearTimeout(state.typingClearTimer);
  subEl.textContent = "";
}

function bindListClicks(state) {
  const { list } = state.els;

  list.querySelectorAll(".cw-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const peerId = btn.dataset.peer;
      const username = btn.dataset.username;

      if (!peerId) return;

      resetChatStateBeforeOpen(state, peerId);
      openChatUI(state, username || findInboxName(state, peerId));

      // dm open
      state.socket.emit("dm:open", { peerId });
    });
  });
}

function findInboxName(state, peerId) {
  const c = state.INBOX.find(x => String(x.peerId) === String(peerId));
  return c?.peerUsername || "Kullanıcı";
}

export function bindEvents(state) {
  const {
    root, fab, peoplePanel, chatPanel,
    closePeople, closeChat, backBtn,
    list, search, subEl,
    form, textInput
  } = state.els;

  root.addEventListener("click", (e) => e.stopPropagation());

  // fab
  fab.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = peoplePanel.classList.contains("open") || chatPanel.classList.contains("open");
    if (isOpen) closeAll(state);
    else openPeople(state);
  });

  // close buttons
  closePeople.addEventListener("click", (e) => { e.stopPropagation(); closeAll(state); });
  closeChat.addEventListener("click", (e) => { e.stopPropagation(); closeAll(state); });
  backBtn.addEventListener("click", (e) => { e.stopPropagation(); openPeople(state); });

  // ctx menu close
  window.addEventListener("scroll", () => closeCtxMenu(state), { passive: true });
  window.addEventListener("resize", () => closeCtxMenu(state));

  // search (debounce)
  search.addEventListener("input", (e) => {
    const q = e.target.value.trim();

    if (!q) {
      state.searchMode = "inbox";
      renderInbox(state, "");
      bindListClicks(state);
      return;
    }

    state.searchMode = "users";
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(async () => {
      try {
        const arr = await searchUsersApi(state, q);
        renderUserResults(state, arr);
        bindListClicks(state);
      } catch (err) {
        console.error(err);
      }
    }, 250);
  });

  // typing emit
  textInput.addEventListener("input", () => {
    if (!state.socket || !state.currentConversationId) return;

    if (!state.isTyping) {
      state.isTyping = true;
      state.socket.emit("typing:start", { conversationId: state.currentConversationId });
    }

    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
      if (!state.isTyping) return;
      state.isTyping = false;
      state.socket.emit("typing:stop", { conversationId: state.currentConversationId });
    }, 600);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const value = textInput.value.trim();
    if (!value) return;
    if (!state.socket || !state.currentConversationId) return;

    // typing stop
    if (state.isTyping) {
      state.isTyping = false;
      clearTimeout(state.typingTimer);
      state.socket.emit("typing:stop", { conversationId: state.currentConversationId });
    }

    try {
      const aesKey = await ensureConversationKeyFor(state, state.currentConversationId, state.currentPeerId);

      const e2eePacket = await encryptMessage(
        aesKey,
        {
          conversationId: state.currentConversationId,
          senderId: state.myId,
          receiverId: state.currentPeerId,
          sentAt: new Date().toISOString(),
          messageId: crypto.randomUUID()
        },
        value
      );

      state.socket.emit("message:send", {
        conversationId: state.currentConversationId,
        e2ee: e2eePacket
      });

      textInput.value = "";
      renderPresence(state);
    } catch (err) {
      console.error("send encrypt failed:", err);
      if (String(err?.message) === "PEER_E2EE_NOT_READY") {
        alert("Karşı taraf E2EE'yi kurmamış (keys/register yapılmamış).");
        return;
      }
      throw err;
      alert("Mesaj şifrelenemedi (E2EE).");
    }
  });
}