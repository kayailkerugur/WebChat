import { createState } from "./state.js";
import { bindEvents } from "./events.js";
import { connectSocket } from "./socket.js";
import { initE2EEIdentity } from "./crypto/initE2EEIdentity.js";
import { registerMyKeys } from "./api.js";

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
    state.identity = await initE2EEIdentity({
        password: "123456",
        deviceId: state.myDeviceId
    });

    console.log("Identity ready:", state.identity);
    if (state.identity?.isNew) {
        await registerMyKeys(state);
    }
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