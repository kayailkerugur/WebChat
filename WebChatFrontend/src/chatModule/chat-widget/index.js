import { createState } from "./state.js";
import { bindEvents } from "./events.js";
import { connectSocket } from "./socket.js";
import { registerKeysToServer, ensureIdentityWithRestore, fetchMyWrappedKey } from "./api.js";
import { aesKeyByConv } from "./e2eeKey.js";
import { jwkFp } from "./crypto/encryption.js";
import { initE2EEIdentity, getEncryptedIdentityRecord, setEncryptedIdentityRecord } from "./crypto/initE2EEIdentity.js";

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

export async function loadPinFromStorage(state) {
    return localStorage.getItem(`e2ee_pin:${state.myId}`); // user-scoped
}

export async function savePinToStorage(state, pin) {
    localStorage.setItem(`e2ee_pin:${state.myId}`, String(pin));
}

async function ensureIdentityAndRegister(state, pin) {
    const serverKey = await fetchMyWrappedKey({ state, deviceId: state.myDeviceId }); // 404 -> null

    if (serverKey?.kdf && serverKey?.wrappedPriv) {
        await setEncryptedIdentityRecord({
            v: 1,
            deviceId: state.myDeviceId,
            kdf: serverKey.kdf,
            enc: serverKey.wrappedPriv,
            createdAt: new Date().toISOString(),
            updatedAt: serverKey.updatedAt || new Date().toISOString(),
        });
    }

    state.identity = await initE2EEIdentity({ password: pin, deviceId: state.myDeviceId });

    if (!serverKey) {
        await registerKeysToServer({ state, identity: state.identity });
    }

    console.log("MY dh_pub fp:", await jwkFp(state.identity.pub.dhPubJwk));
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

    if (await loadPinFromStorage(state) === null) { 
        await savePinToStorage(state, "123456");
    }

    await ensureIdentityAndRegister(state, await loadPinFromStorage(state));
    connectSocket(state);
    bindEvents(state);
}

document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("cw")) initChatWidget().catch(console.error);
});