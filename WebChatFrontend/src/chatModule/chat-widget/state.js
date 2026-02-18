export function createState() {
    const API_BASE = "http://localhost:3000";

    const token = localStorage.getItem("jwt_token");
    const me = JSON.parse(localStorage.getItem("me_user") || "null");
    const myId = me?.id || me?.userId;

    const myDeviceId = localStorage.getItem("e2ee_device_id") || "web-1";
    localStorage.setItem("e2ee_device_id", myDeviceId);

    return {
        API_BASE,
        token,
        me,
        myId,
        myDeviceId,

        // DOM refs (index.js dolduracak)
        els: null,

        // E2EE state
        identity: null,
        peerKeyCache: new Map(),   // peerId -> bestKey
        aesKeyByConv: new Map(),   // cacheKey -> CryptoKey

        // Conversation state
        INBOX: [],
        USER_RESULTS: [],
        searchMode: "inbox",

        currentPeerId: null,
        currentConversationId: null,

        peerLastReadAt: null,
        currentHistory: [],
        historyIds: new Set(),

        // typing
        typingTimer: null,
        isTyping: false,
        typingClearTimer: null,

        // presence
        peerPresence: { isOnline: false, lastSeen: null },

        // context menu
        ctxMenuEl: null,

        // socket
        socket: null,
    };
}

export function resetChatStateBeforeOpen(state, peerId) {
    state.currentPeerId = peerId;
    state.currentConversationId = null;

    state.peerLastReadAt = null;
    state.peerPresence = { isOnline: false, lastSeen: null };

    state.currentHistory = [];
    state.historyIds = new Set();

    state.isTyping = false;
    clearTimeout(state.typingTimer);
    clearTimeout(state.typingClearTimer);
}