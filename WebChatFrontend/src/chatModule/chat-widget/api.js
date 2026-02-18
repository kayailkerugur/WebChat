export async function loadConversations(state) {
    const res = await fetch(`${state.API_BASE}/conversations`, {
        headers: { Authorization: `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error("conversations fetch failed");

    const data = await res.json();
    state.INBOX = data.conversations || [];
    return state.INBOX;
}

export async function searchUsersApi(state, q) {
    const res = await fetch(`${state.API_BASE}/users/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error("user search failed");

    const data = await res.json();
    state.USER_RESULTS = (data.users || []).filter(u => u.id !== state.myId);
    return state.USER_RESULTS;
}

export async function registerMyKeys(state) {
    const res = await fetch(`${state.API_BASE}/api/e2ee/keys/register`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${state.token}`
        },
        body: JSON.stringify({
            deviceId: state.identity.deviceId,
            signPubJwk: state.identity.pub.signPubJwk,
            dhPubJwk: state.identity.pub.dhPubJwk
        })
    });

    console.log("register keys response:", res);
    if (!res.ok) throw new Error("E2EE key register failed");
    return res.json();
}

export async function fetchPeerKeys(state, peerId) {
    if (state.peerKeyCache.has(peerId)) return state.peerKeyCache.get(peerId);

    console.log(state.token)
    const res = await fetch(`${state.API_BASE}/api/e2ee/keys/${peerId}`, {
        headers: { Authorization: `Bearer ${state.token}` }
    });

    if (!res.ok) throw new Error("peer keys fetch failed");
    const data = await res.json();

    console.log(data)

    const best = (data.keys || [])[0];
    if (!best?.dhPubJwk) throw new Error("peer dhPubJwk missing");

    state.peerKeyCache.set(peerId, best);
    return best;
}