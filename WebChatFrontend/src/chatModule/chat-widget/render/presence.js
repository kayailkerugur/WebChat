export function renderPresence(state) {
    const { subEl } = state.els;

    if (!state.currentPeerId) {
        subEl.textContent = "";
        return;
    }

    const p = state.peerPresence;

    if (p?.isOnline) {
        subEl.textContent = "🟢 Çevrimiçi";
        return;
    }

    if (p?.lastSeen) {
        const d = new Date(p.lastSeen);
        subEl.textContent = "Son görülme: " + d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
        return;
    }

    subEl.textContent = "";
}