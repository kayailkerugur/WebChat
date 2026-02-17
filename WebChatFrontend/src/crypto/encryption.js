const AES = "AES-GCM";
const IV_LEN = 12;

const te = new TextEncoder();
const td = new TextDecoder();

function randBytes(n) {
    const x = new Uint8Array(n);
    crypto.getRandomValues(x);
    return x;
}

function b64(bytes) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
}

function unb64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * AAD (Additional Authenticated Data):
 * Şifrelenmez ama "doğrulanır". Paket metadata'sı değişirse decrypt patlar.
 * Bu sayede biri senderId/timestamp gibi alanları oynarsa mesaj bozulur.
 */
function buildAAD({ conversationId, senderId, receiverId, sentAt, messageId }) {
    const aadObj = { v: 1, conversationId, senderId, receiverId, sentAt, messageId };
    return te.encode(JSON.stringify(aadObj));
}

/**
 * Encrypt message payload
 * @param {CryptoKey} aesKey - Step 2'den gelen conversation/session key
 * @param {object} meta - konuşma + kimlik metaları
 * @param {string} plaintext - mesaj metni
 */
export async function encryptMessage(aesKey, meta, plaintext) {
    const iv = randBytes(IV_LEN);
    const aad = buildAAD(meta);

    const ptBytes = te.encode(plaintext);

    const ctBuf = await crypto.subtle.encrypt(
        { name: AES, iv, additionalData: aad, tagLength: 128 },
        aesKey,
        ptBytes
    );

    const ct = new Uint8Array(ctBuf);

    // Sunucuya gidecek wire format (JSON)
    return {
        v: 1,
        conversationId: meta.conversationId,
        messageId: meta.messageId,
        senderId: meta.senderId,
        receiverId: meta.receiverId,
        sentAt: meta.sentAt, // ISO string öneririm
        alg: "AES-256-GCM",
        iv_b64: b64(iv),
        ct_b64: b64(ct),
        // aad ayrı taşınmayabilir; meta zaten var. Ama decrypt için aynı AAD'yi yeniden üretmelisin.
    };
}

/**
 * Decrypt message payload
 * @param {CryptoKey} aesKey - Step 2'den gelen aynı key
 * @param {object} packet - server'dan gelen şifreli mesaj paketi
 */
export async function decryptMessage(aesKey, packet) {
    const meta = {
        conversationId: packet.conversationId,
        senderId: packet.senderId,
        receiverId: packet.receiverId,
        sentAt: packet.sentAt,
        messageId: packet.messageId,
    };

    const iv = unb64(packet.iv_b64);
    const ct = unb64(packet.ct_b64);
    const aad = buildAAD(meta);

    const ptBuf = await crypto.subtle.decrypt(
        { name: AES, iv, additionalData: aad, tagLength: 128 },
        aesKey,
        ct
    );

    return td.decode(ptBuf);
}