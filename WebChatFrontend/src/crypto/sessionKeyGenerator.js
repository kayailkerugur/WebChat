const te = new TextEncoder();

async function importEcdhPublicKeyFromJwk(dhPubJwk) {
    return crypto.subtle.importKey(
        "jwk",
        dhPubJwk,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        []
    );
}

async function deriveSharedSecretBits(myDhPrivateKey, theirDhPublicKey) {
    // 256-bit shared secret bits
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

// conversationId: iki kişi arasındaki chat id (ör: "userA:userB" gibi deterministik)
// myUserId / theirUserId: info string için
export async function getConversationAesKey({
    myDhPrivateKey,
    theirDhPubJwk,
    conversationId,
    myUserId,
    theirUserId
}) {
    // 1) karşı taraf public key import
    const theirPub = await importEcdhPublicKeyFromJwk(theirDhPubJwk);

    // 2) ECDH shared secret
    const sharedBits = await deriveSharedSecretBits(myDhPrivateKey, theirPub);

    // 3) HKDF salt + info
    // Salt'ı konuşma bazlı deterministik yapma (random daha iyi).
    // Burada MVP için conversationId'den salt türetiyoruz; Step 3'te random salt + state tutacağız.
    const salt = await crypto.subtle.digest("SHA-256", te.encode("salt|" + conversationId));
    const saltBytes = new Uint8Array(salt);

    const info = `e2ee-chat|v1|${conversationId}|${myUserId}|${theirUserId}`;

    // 4) AES session key
    const aesKey = await hkdfToAesKey(sharedBits, saltBytes, info);
    return aesKey;
}