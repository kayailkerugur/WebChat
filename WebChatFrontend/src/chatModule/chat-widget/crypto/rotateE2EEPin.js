const KDF_ITER_DEFAULT = 210_000;
const KDF_HASH_DEFAULT = "SHA-256";
const AES = "AES-GCM";
const SALT_LEN = 16;
const IV_LEN = 12;

const te = new TextEncoder();
const td = new TextDecoder();

// ---------- base64 ----------
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
function randBytes(n) {
  const x = new Uint8Array(n);
  crypto.getRandomValues(x);
  return x;
}

// ---------- KDF + AES-GCM ----------
async function deriveKekFromPassword(password, salt, iter = KDF_ITER_DEFAULT, hash = KDF_HASH_DEFAULT) {
  const baseKey = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: iter, hash },
    baseKey,
    { name: AES, length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function aesGcmEncrypt(kek, plaintextBytes) {
  const iv = randBytes(IV_LEN);
  const ctBuf = await crypto.subtle.encrypt({ name: AES, iv }, kek, plaintextBytes);
  return { iv, ct: new Uint8Array(ctBuf) };
}

async function aesGcmDecrypt(kek, iv, ctBytes) {
  const ptBuf = await crypto.subtle.decrypt({ name: AES, iv }, kek, ctBytes);
  return new Uint8Array(ptBuf);
}

/**
 * rotateE2EEPin
 *
 * @param {object} params
 * @param {object} params.state - createState() içinden gelen state (API_BASE, token vs.)
 * @param {string} params.deviceId
 * @param {string} params.oldPin
 * @param {string} params.newPin
 * @param {function} params.getEncryptedIdentityRecord - IDB'den record okuyacak fn
 * @param {function} params.setEncryptedIdentityRecord - IDB'ye record yazacak fn
 *
 * Not: Bu fonksiyon server'da decrypt etmez. Sadece client decrypt->re-encrypt yapar.
 */
export async function rotateE2EEPin({
  state,
  deviceId,
  oldPin,
  newPin,
  getEncryptedIdentityRecord,
  setEncryptedIdentityRecord,
}) {
  if (!state?.token) throw new Error("TOKEN_REQUIRED");
  if (!deviceId) throw new Error("DEVICE_ID_REQUIRED");
  if (!oldPin || !newPin) throw new Error("OLD_NEW_PIN_REQUIRED");
  if (oldPin === newPin) return { ok: true, skipped: true };

  if (typeof getEncryptedIdentityRecord !== "function") throw new Error("getEncryptedIdentityRecord required");
  if (typeof setEncryptedIdentityRecord !== "function") throw new Error("setEncryptedIdentityRecord required");

  const record = await getEncryptedIdentityRecord(); // {v, deviceId, kdf, enc, ...}
  if (!record?.kdf || !record?.enc) throw new Error("NO_LOCAL_IDENTITY_RECORD");

  const iter = Number(record?.kdf?.iter ?? KDF_ITER_DEFAULT);
  const hash = String(record?.kdf?.hash ?? KDF_HASH_DEFAULT);

  const salt = unb64(record.kdf.salt_b64);
  const iv = unb64(record.enc.iv_b64);
  const ct = unb64(record.enc.ct_b64);

  let payloadObj;
  try {
    const kekOld = await deriveKekFromPassword(String(oldPin).normalize("NFKC"), salt, iter, hash);
    const ptBytes = await aesGcmDecrypt(kekOld, iv, ct);
    payloadObj = JSON.parse(td.decode(ptBytes)); // { deviceId, privJwks, pubJwks }
  } catch (e) {
    if (e?.name === "OperationError") throw new Error("OLD_PIN_INVALID");
    throw e;
  }

  const newSalt = randBytes(SALT_LEN);
  const kekNew = await deriveKekFromPassword(String(newPin).normalize("NFKC"), newSalt, iter, hash);

  const newPayloadBytes = te.encode(JSON.stringify(payloadObj));
  const { iv: newIv, ct: newCt } = await aesGcmEncrypt(kekNew, newPayloadBytes);

  const kdf = { alg: "PBKDF2", hash, iter, salt_b64: b64(newSalt) };
  const wrappedPriv = { alg: AES, iv_b64: b64(newIv), ct_b64: b64(newCt) };

  const now = new Date().toISOString();
  const newRecord = {
    v: 1,
    deviceId,
    kdf,
    enc: wrappedPriv,
    createdAt: record.createdAt || now,
    updatedAt: now,
  };
  await setEncryptedIdentityRecord(newRecord);

  const res = await fetch(`${state.API_BASE}/api/e2ee/keys/change-pin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.token}`,
    },
    body: JSON.stringify({ deviceId, kdf, wrappedPriv }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`CHANGE_PIN_FAILED:${res.status}:${txt}`);
  }

  const data = await res.json().catch(() => ({}));
  return { ok: true, ...data };
}