import { getEncryptedIdentityRecord, setEncryptedIdentityRecord, initE2EEIdentity } from "./crypto/initE2EEIdentity.js";

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

    const res = await fetch(`${state.API_BASE}/api/e2ee/keys/${peerId}`, {
        headers: { Authorization: `Bearer ${state.token}` }
    });

    if (!res.ok) throw new Error("peer keys fetch failed");
    const data = await res.json();

    const best = (data.keys || [])[0];
    if (!best?.dhPubJwk) throw new Error("peer dhPubJwk missing");

    state.peerKeyCache.set(peerId, best);
    return best;
}

export async function registerKeysToServer({ state, token, identity }) {
    const record = await getEncryptedIdentityRecord(); 
    if (!record?.kdf || !record?.enc) {
        throw new Error("LOCAL_IDENTITY_RECORD_MISSING_FOR_BACKUP");
    }

    const res = await fetch(`${state.API_BASE}/api/e2ee/keys/register`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            deviceId: identity.deviceId,
            signPubJwk: identity.pub.signPubJwk,
            dhPubJwk: identity.pub.dhPubJwk,
            kdf: record?.kdf,
            wrappedPriv: record?.enc
        })
    });

    if (!res.ok) throw new Error("E2EE key register failed");
    return res.json();
}

export async function restoreIdentityFromServer({ state, token, deviceId }) {
    const res = await fetch(`${state.API_BASE}/api/e2ee/keys/me?deviceId=${encodeURIComponent(deviceId)}`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) return false; // sunucuda yoksa restore yok
    const data = await res.json();

    const kdf = data?.key?.kdf;
    const wrappedPriv = data?.key?.wrappedPriv;

    if (!kdf || !wrappedPriv) return false;

    // IDB record formatına çevir
    const record = {
        v: 1,
        deviceId,
        kdf,
        enc: wrappedPriv,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    await setEncryptedIdentityRecord(record);
    return true;
}

export async function ensureIdentityWithRestore({ state, token, deviceId, pin }) {

    await restoreIdentityFromServer({ state, token, deviceId });

    return initE2EEIdentity({ password: pin, deviceId });
}