const te = new TextEncoder();

function normalizedInfo(conversationId, myUserId, theirUserId) {
    const [a, b] = [String(myUserId), String(theirUserId)].sort();
    return `e2ee-chat|v1|${conversationId}|${a}|${b}`;
}

async function importEcdhPublicKeyFromJwk(dhPubJwk) {
    return crypto.subtle.importKey(
        "jwk",
        dhPubJwk,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        [] // ✅ ECDH public key için doğru kullanım
    );
}

async function deriveSharedSecretBits(myDhPrivateKey, theirDhPublicKey) {
    return crypto.subtle.deriveBits(
        { name: "ECDH", public: theirDhPublicKey },
        myDhPrivateKey,
        256
    );
}

async function hkdfToAesKey(sharedSecretBits, saltBytes, infoStr) {
    const hkdfKey = await crypto.subtle.importKey(
        "raw",
        sharedSecretBits,
        "HKDF",
        false,
        ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: saltBytes,
            info: te.encode(infoStr),
        },
        hkdfKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

export async function getConversationAesKey({
    myDhPrivateKey,
    theirDhPubJwk,
    conversationId,
    myUserId,
    theirUserId
}) {
    if (!myDhPrivateKey) throw new Error("myDhPrivateKey missing");
    if (!theirDhPubJwk) throw new Error("theirDhPubJwk missing");
    if (!conversationId) throw new Error("conversationId missing");

    const theirPub = await importEcdhPublicKeyFromJwk(theirDhPubJwk);
    const sharedBits = await deriveSharedSecretBits(myDhPrivateKey, theirPub);

    // MVP deterministic salt (prod'da random + state önerilir)
    const saltBuf = await crypto.subtle.digest("SHA-256", te.encode("salt|" + conversationId));
    const saltBytes = new Uint8Array(saltBuf);

    const info = normalizedInfo(conversationId, myUserId, theirUserId);

    return hkdfToAesKey(sharedBits, saltBytes, info);
}