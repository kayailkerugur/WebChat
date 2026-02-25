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

    if (res.status === 404) {
        return null;
    }

    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`peer keys fetch failed: ${res.status} ${txt}`);
    }

    const data = await res.json().catch(() => ({}));
    const best = (data.keys || [])[0];
    if (!best?.dhPubJwk) throw new Error("peer dhPubJwk missing");

    state.peerKeyCache.set(peerId, best);
    return best;
}

export async function registerKeysToServer({ state, identity }) {
    const record = await getEncryptedIdentityRecord();
    if (!record?.kdf || !record?.enc) {
        throw new Error("LOCAL_IDENTITY_RECORD_MISSING_FOR_BACKUP");
    }

    if (record.deviceId && record.deviceId !== identity.deviceId) {
        throw new Error("LOCAL_RECORD_DEVICE_MISMATCH");
    }

    const res = await fetch(`${state.API_BASE}/api/e2ee/keys/register`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${state.token}`,
        },
        body: JSON.stringify({
            deviceId: identity.deviceId,
            signPubJwk: identity.pub.signPubJwk,
            dhPubJwk: identity.pub.dhPubJwk,
            kdf: record.kdf,
            wrappedPriv: record.enc,
        }),
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`E2EE_KEY_REGISTER_FAILED:${res.status}:${txt}`);
    }
    return res.json().catch(() => ({}));
}

export async function restoreIdentityFromServer({ state, token, deviceId }) {
    const res = await fetch(`${state.API_BASE}/api/e2ee/keys/me?deviceId=${encodeURIComponent(deviceId)}`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) return false; 
    const data = await res.json();

    const kdf = data?.key?.kdf;
    const wrappedPriv = data?.key?.wrappedPriv;

    if (!kdf || !wrappedPriv) return false;

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

export async function ensureIdentityWithRestore({ state, deviceId, pin }) {
    const local = await getEncryptedIdentityRecord(); // {kdf, enc,...} bekliyorsun

    const serverKeyRaw = await fetchMyWrappedKey({ state, deviceId }); // 404 -> null

    if (!serverKeyRaw) {
        if (!local?.kdf || !local?.enc) throw new Error("NO_LOCAL_IDENTITY_RECORD");

        const ident = await initE2EEIdentity({ password: pin, deviceId });

        await registerMyKeysIfMissing({
            state,
            deviceId,
            signPubJwk: ident.pub.signPubJwk, // sende isimler nasıl bilmiyorum
            dhPubJwk: ident.pub.dhPubJwk,
            kdf: local.kdf,
            wrappedPriv: local.enc,
        });

        aesKeyByConv?.clear?.();
        return ident;
    }

    const serverEnc = serverKeyRaw.wrappedPriv ?? serverKeyRaw.wrapped_priv;
    const serverUpdatedAt = serverKeyRaw.updatedAt ?? serverKeyRaw.updated_at ?? new Date().toISOString();

    if (serverKeyRaw?.kdf && serverEnc) {
        await setEncryptedIdentityRecord({
            v: 1,
            deviceId,
            kdf: serverKeyRaw.kdf,
            enc: serverEnc,
            createdAt: local?.createdAt || new Date().toISOString(),
            updatedAt: serverUpdatedAt,
        });
    }

    const ident = await initE2EEIdentity({ password: pin, deviceId });
    aesKeyByConv?.clear?.();
    return ident;
}

// api.js
export async function changePinOnServer({ state, deviceId, kdf, wrappedPriv }) {
    const res = await fetch(`${state.API_BASE}/api/e2ee/keys/change-pin`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${state.token}`
        },
        body: JSON.stringify({ deviceId, kdf, wrappedPriv })
    });

    if (!res.ok) throw new Error("CHANGE_PIN_FAILED");
    return res.json();
}

// api.js
export async function fetchMyWrappedKey({ state, deviceId }) {
    const res = await fetch(
        `${state.API_BASE}/api/e2ee/keys/me?deviceId=${encodeURIComponent(deviceId)}`,
        { headers: { Authorization: `Bearer ${state.token}` } }
    );

    if (res.status === 404) return null;

    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`FETCH_MY_KEYS_FAILED:${res.status}:${txt}`);
    }

    const data = await res.json().catch(() => null);
    const key = data?.key;
    if (!key) return null;

    return {
        userId: key.userId ?? key.user_id,
        deviceId: key.deviceId ?? key.device_id,
        signPubJwk: key.signPubJwk ?? key.sign_pub_jwk,
        dhPubJwk: key.dhPubJwk ?? key.dh_pub_jwk,
        kdf: key.kdf,
        wrappedPriv: key.wrappedPriv ?? key.wrapped_priv,
        updatedAt: key.updatedAt ?? key.updated_at,
    };
}