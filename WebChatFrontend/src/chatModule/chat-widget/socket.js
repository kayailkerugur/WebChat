import { loadConversations } from "./api.js";
import { renderHistory, appendMessage, updateReadTicks } from "./render/messages.js";
import { renderPresence } from "./render/presence.js";

import { decryptMessage } from "./crypto/encryption.js";
import { ensureConversationKeyFor } from "./e2eeKey.js";
import { jwkFp } from "./crypto/encryption.js";

export function connectSocket(state) {
    const socket = io(state.API_BASE, {
        transports: ["websocket"],
        auth: { token: state.token },
    });

    state.socket = socket;

    socket.on("connect", () => console.log("✅ socket connected", socket.id));
    socket.on("disconnect", () => console.log("❌ socket disconnected"));
    socket.on("error", (e) => console.log("ERR:", e));

    socket.on("conversation:read:ok", () => loadConversations(state).catch(console.error));

    let printedFp = false;

    // dm state
    socket.on("dm:state", async ({ conversationId, history, myUserId, peerLastReadAt, presence }) => {
        try {
            state.currentConversationId = conversationId;
            state.peerLastReadAt = peerLastReadAt || null;

            const decryptedHistory = [];

            for (const m of (history || [])) {
                try {
                    if (m?.deletedForAll) {
                        decryptedHistory.push({ ...m, text: "Mesaj silindi" });
                        continue;
                    }

                    if (m?.e2ee?.ct_b64 && m?.e2ee?.iv_b64) {
                        const senderId = String(m?.from?.userId);
                        const myId = String(myUserId);

                        const peerId = (senderId === myId)
                            ? String(m?.e2ee?.receiverId)
                            : senderId;

                        const aesKey = await ensureConversationKeyFor(state, conversationId, peerId);
                        const plain = await decryptMessage(aesKey, m.e2ee);

                        decryptedHistory.push({ ...m, text: plain });
                    } else {
                        decryptedHistory.push(m);
                    }
                } catch (e) {
                    if (!printedFp) {
                        printedFp = true;
                        console.log("MY dh_pub fp (during decrypt fail):", await jwkFp(state.identity.pub.dhPubJwk));
                        console.log("MY deviceId:", state.myDeviceId);
                        console.log("MY userId:", state.myId);
                    }
                    console.error("decrypt fail for msg", m?.id, e);
                    decryptedHistory.push({ ...m, text: "🔒 Şifreli mesaj (çözülemedi)" });
                }
            }

            state.currentHistory = decryptedHistory;
            renderHistory(state, state.currentHistory);
            updateReadTicks(state);

            state.peerPresence = { isOnline: !!presence?.isOnline, lastSeen: presence?.lastSeen || null };
            renderPresence(state);

            socket.emit("conversation:read", { conversationId });
        } catch (err) {
            console.error("dm:state decrypt failed:", err);
            state.els.messagesEl.innerHTML = `<div class="cw-msg them">Mesajlar çözülemedi (E2EE)</div>`;
        }
    });

    // new message
    socket.on("message:new", async ({ conversationId, message }) => {
        if (conversationId !== state.currentConversationId) return;

        let uiMsg = message;

        try {
            if (message?.deletedForAll) {
                uiMsg = { ...message, text: "Mesaj silindi" };
            } else if (message?.e2ee?.ct_b64 && message?.e2ee?.iv_b64) {
                const peerId = message?.e2ee?.senderId || state.currentPeerId;

                const aesKey = await ensureConversationKeyFor(state, conversationId, peerId);
                const plain = await decryptMessage(aesKey, message.e2ee);
                uiMsg = { ...message, text: plain };
            }
        } catch (e) {
            console.error("incoming decrypt failed:", e);
            if (message?.e2ee) uiMsg = { ...message, text: "🔒 Şifreli mesaj (çözülemedi)" };
        }

        state.currentHistory.push(uiMsg);
        appendMessage(state, uiMsg);

        const fromId = uiMsg?.from?.userId;
        if (fromId && fromId !== state.myId) {
            socket.emit("conversation:read", { conversationId });
        }
    });

    socket.on("read:updated", ({ conversationId, userId, lastReadAt }) => {
        if (conversationId !== state.currentConversationId) return;

        if (userId !== state.myId) {
            state.peerLastReadAt = lastReadAt;
            updateReadTicks(state);
        }
    });

    socket.on("typing", ({ conversationId, isTyping }) => {
        if (conversationId !== state.currentConversationId) return;

        if (isTyping) {
            state.els.subEl.textContent = "yazıyor...";
            clearTimeout(state.typingClearTimer);
            state.typingClearTimer = setTimeout(() => {
                renderPresence(state);
            }, 2000);
        } else {
            clearTimeout(state.typingClearTimer);
            renderPresence(state);
        }
    });

    socket.on("presence:update", ({ userId, isOnline, lastSeen }) => {
        if (userId !== state.currentPeerId) return;

        state.peerPresence = { isOnline: !!isOnline, lastSeen: lastSeen || null };

        if (!state.els.subEl.textContent.includes("yazıyor")) {
            renderPresence(state);
        }
    });

    socket.on("message:deleted", ({ scope, conversationId, messageId }) => {
        if (conversationId !== state.currentConversationId) return;

        if (scope === "me") {
            state.currentHistory = state.currentHistory.filter((m) => m.id !== messageId);
            renderHistory(state, state.currentHistory);
            return;
        }

        // scope === all
        const m = state.currentHistory.find((x) => x.id === messageId);
        if (m) {
            m.deletedForAll = true;
            m.text = "Mesaj silindi";
        }
        renderHistory(state, state.currentHistory);
    });

    return socket;
}