// encryption.js
const AES = "AES-GCM";
const IV_LEN = 12;

const te = new TextEncoder();
const td = new TextDecoder();

function randBytes(n) {
  const x = new Uint8Array(n);
  crypto.getRandomValues(x);
  return x;
}

// Uint8Array -> base64
function b64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// base64 -> Uint8Array
function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function buildAAD(packetOrMeta) {
  const aadObj = {
    v: 1,
    conversationId: packetOrMeta.conversationId,
    messageId: packetOrMeta.messageId,
    senderId: packetOrMeta.senderId,
    receiverId: packetOrMeta.receiverId
  };
  return te.encode(JSON.stringify(aadObj));
}

async function aadFingerprint(aad) {
  const h = await crypto.subtle.digest("SHA-256", aad);
  return b64(new Uint8Array(h));
}

/**
 * Encrypt
 * meta: { conversationId, messageId, senderId, receiverId, sentAt? }
 */
export async function encryptMessage(aesKey, meta, plaintext) {
  if (!aesKey) throw new Error("aesKey missing");
  if (!meta?.conversationId || !meta?.messageId || !meta?.senderId || !meta?.receiverId) {
    throw new Error("meta missing fields (conversationId,messageId,senderId,receiverId)");
  }

  const iv = randBytes(IV_LEN);
  const aad = buildAAD(meta);
  const ptBytes = te.encode(String(plaintext ?? ""));

  const ctBuf = await crypto.subtle.encrypt(
    { name: AES, iv, additionalData: aad, tagLength: 128 },
    aesKey,
    ptBytes
  );

  const ct = new Uint8Array(ctBuf);

  return {
    v: 1,
    alg: "AES-256-GCM",
    conversationId: meta.conversationId,
    messageId: meta.messageId,
    senderId: meta.senderId,
    receiverId: meta.receiverId,
    sentAt: meta.sentAt || new Date().toISOString(), // UI için
    iv_b64: b64(iv),
    ct_b64: b64(ct)
  };
}

/**
 * Decrypt
 * packet: encryptMessage
 */
export async function decryptMessage(aesKey, packet) {
  if (!aesKey) throw new Error("aesKey missing");
  if (!packet?.iv_b64 || !packet?.ct_b64) throw new Error("packet missing iv_b64/ct_b64");

  const iv = unb64(packet.iv_b64);
  const ct = unb64(packet.ct_b64);

  try {
    if (packet?.conversationId && packet?.messageId && packet?.senderId && packet?.receiverId) {
      const aad = buildAAD(packet);
      const ptBuf = await crypto.subtle.decrypt(
        { name: AES, iv, additionalData: aad, tagLength: 128 },
        aesKey,
        ct
      );
      return td.decode(ptBuf);
    }
  } catch (e) {
    if (e?.name !== "OperationError") throw e;
  }

  const ptBuf = await crypto.subtle.decrypt(
    { name: AES, iv, tagLength: 128 },
    aesKey,
    ct
  );
  return td.decode(ptBuf);
}

export function jwkFp(jwk) {
    const s = JSON.stringify(jwk);
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
        .then(buf => btoa(String.fromCharCode(...new Uint8Array(buf))));
}