import { createState } from "./state.js";
import { bindEvents } from "./events.js";
import { connectSocket } from "./socket.js";
import { registerKeysToServer, ensureIdentityWithRestore } from "./api.js";

function getEls() {
    const root = document.getElementById("cw");
    if (!root) return null;

    const els = {
        root,
        fab: document.getElementById("cwFab"),
        peoplePanel: document.getElementById("cwPeople"),
        chatPanel: document.getElementById("cwChat"),
        closePeople: document.getElementById("cwClosePeople"),
        closeChat: document.getElementById("cwCloseChat"),
        backBtn: document.getElementById("cwBack"),
        list: document.getElementById("cwList"),
        search: document.getElementById("cwSearch"),
        nameEl: document.getElementById("cwName"),
        avatarEl: document.getElementById("cwAvatar"),
        subEl: document.getElementById("cwSub"),
        messagesEl: document.getElementById("cwMessages"),
        form: document.getElementById("cwForm"),
        textInput: document.getElementById("cwText"),
    };

    const missing = Object.entries(els).filter(([_, v]) => !v).map(([k]) => k);
    if (missing.length) {
        console.error("[chat-widget] Eksik elementler:", missing);
        return null;
    }

    return els;
}

async function ensureIdentityAndRegister(state) {
    const pin = "123456";
    const token = state.token;

    state.identity = await ensureIdentityWithRestore({
        state,
        token,
        deviceId: state.myDeviceId,
        pin
    });

    await registerKeysToServer({
        state,
        token,
        identity: state.identity
    });
}

export async function initChatWidget() {
    const root = document.getElementById("cw");
    if (!root) return;
    if (root.dataset.initialized === "true") return;
    root.dataset.initialized = "true";

    const state = createState();

    if (!state.token || !state.me || !state.myId) {
        console.warn("jwt_token / me_user yok. Önce select-user.html ile login ol.");
        return;
    }

    const els = getEls();
    if (!els) return;

    state.els = els;

    await ensureIdentityAndRegister(state);

    connectSocket(state);
    bindEvents(state);
}

document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("cw")) initChatWidget().catch(console.error);
});