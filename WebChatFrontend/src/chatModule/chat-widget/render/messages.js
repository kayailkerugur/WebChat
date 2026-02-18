import { openCtxMenu } from "./contextMenu.js";

export function appendMessage(state, msg) {
    const { messagesEl } = state.els;
    const div = document.createElement("div");
    const isMe = msg?.from?.userId === state.myId;
    const deletedForAll = !!msg?.deletedForAll;

    div.className = `cw-msg ${isMe ? "me" : "them"}`;
    if (deletedForAll) div.classList.add("deleted");

    const text = document.createElement("span");
    text.className = "cw-text";
    text.textContent = deletedForAll ? "Mesaj silindi" : (msg?.text ?? "");
    div.appendChild(text);

    if (isMe && !deletedForAll) {
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

    div.dataset.mid = msg.id;

    div.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!state.socket || !state.currentConversationId) return;
        const isMine = msg?.from?.userId === state.myId;

        openCtxMenu(state, {
            x: e.clientX,
            y: e.clientY,
            isMine,
            onDeleteMe: () => {
                state.socket.emit("message:delete", {
                    conversationId: state.currentConversationId,
                    messageId: msg.id,
                    scope: "me"
                });
            },
            onDeleteAll: () => {
                const ok = confirm("Bu mesajı herkes için silmek istiyor musun?");
                if (!ok) return;
                state.socket.emit("message:delete", {
                    conversationId: state.currentConversationId,
                    messageId: msg.id,
                    scope: "all"
                });
            }
        });
    });

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

export function renderHistory(state, history) {
    const { messagesEl } = state.els;
    messagesEl.innerHTML = "";
    state.historyIds = new Set();

    (history || []).forEach(m => appendMessage(state, m));
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

export function updateReadTicks(state) {
    const readAt = state.peerLastReadAt ? new Date(state.peerLastReadAt).getTime() : 0;

    document.querySelectorAll("#cwMessages .cw-ticks").forEach(el => {
        const sentAt = el.dataset.sentAt ? new Date(el.dataset.sentAt).getTime() : 0;
        if (readAt && sentAt && sentAt <= readAt) el.classList.add("read");
        else el.classList.remove("read");
    });
}