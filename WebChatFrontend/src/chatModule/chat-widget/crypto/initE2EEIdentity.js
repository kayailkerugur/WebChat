// e2eeIdentity.js
// Client-side E2EE identity storage (IndexedDB) + local private-key encryption (PBKDF2 -> AES-GCM)

const DB_NAME = "e2ee_db";
const DB_VERSION = 1;
const STORE = "identity";
const RECORD_KEY = "identity_v1";

const KDF_ITER = 210_000;
const KDF_HASH = "SHA-256";
const AES = "AES-GCM";
const SALT_LEN = 16;
const IV_LEN = 12;

const te = new TextEncoder();
const td = new TextDecoder();

// ---------- Base64 helpers ----------
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

// ---------- IndexedDB ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const os = tx.objectStore(STORE);
    const req = os.get(key);

    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);

    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
}

export async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    const req = os.put(value, key);

    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);

    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
}

export async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    const req = os.delete(key);

    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);

    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
}

// ---------- KDF + AES-GCM ----------
async function deriveKekFromPassword(password, salt) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    te.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: KDF_ITER, hash: KDF_HASH },
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

// ---------- Key generation ----------
async function generateIdentityKeyPairs() {
  const signKeyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  // Key agreement key pair (ECDH)
  const dhKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits", "deriveKey"]
  );

  return { signKeyPair, dhKeyPair };
}

async function exportPublicJwks({ signKeyPair, dhKeyPair }) {
  const signPubJwk = await crypto.subtle.exportKey("jwk", signKeyPair.publicKey);
  const dhPubJwk = await crypto.subtle.exportKey("jwk", dhKeyPair.publicKey);
  return { signPubJwk, dhPubJwk };
}

async function exportPrivateJwks({ signKeyPair, dhKeyPair }) {
  const signPrivJwk = await crypto.subtle.exportKey("jwk", signKeyPair.privateKey);
  const dhPrivJwk = await crypto.subtle.exportKey("jwk", dhKeyPair.privateKey);
  return { signPrivJwk, dhPrivJwk };
}

async function importKeysFromJwks(privJwks) {
  const signPrivateKey = await crypto.subtle.importKey(
    "jwk",
    privJwks.signPrivJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const dhPrivateKey = await crypto.subtle.importKey(
    "jwk",
    privJwks.dhPrivJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits", "deriveKey"]
  );

  return { signPrivateKey, dhPrivateKey };
}

// ---------- Storage format (IndexedDB record) ----------
async function storeEncryptedIdentityRecord({ password, deviceId, privJwks, pubJwks }) {
  const salt = randBytes(SALT_LEN);
  const kek = await deriveKekFromPassword(password, salt);

  const payloadObj = { deviceId, privJwks, pubJwks };
  const payloadBytes = te.encode(JSON.stringify(payloadObj));

  const { iv, ct } = await aesGcmEncrypt(kek, payloadBytes);

  const now = new Date().toISOString();

  const record = {
    v: 1,
    deviceId,
    kdf: { alg: "PBKDF2", hash: KDF_HASH, iter: KDF_ITER, salt_b64: b64(salt) },
    enc: { alg: AES, iv_b64: b64(iv), ct_b64: b64(ct) },
    createdAt: now,
    updatedAt: now,
  };

  await idbPut(RECORD_KEY, record);
}

async function loadDecryptedIdentityRecord(password) {
  const record = await idbGet(RECORD_KEY);
  if (!record) return null;
  if (record.v !== 1) throw new Error("E2EE_IDENTITY_UNSUPPORTED_VERSION");

  const salt = unb64(record.kdf.salt_b64);
  const iv = unb64(record.enc.iv_b64);
  const ct = unb64(record.enc.ct_b64);

  const kek = await deriveKekFromPassword(password, salt);

  try {
    const ptBytes = await aesGcmDecrypt(kek, iv, ct);
    return JSON.parse(td.decode(ptBytes));
  } catch (e) {
    if (e?.name === "OperationError") {
      throw new Error("E2EE_PIN_INVALID_OR_RECORD_CORRUPTED");
    }
    throw e;
  }
}

// ---------- Public API ----------
function validateDeviceId(deviceId) {
  if (typeof deviceId !== "string") throw new Error("INVALID_DEVICE_ID");
  const d = deviceId.trim();
  if (!d || d.length > 64) throw new Error("INVALID_DEVICE_ID");
  return d;
}

/**
 * initE2EEIdentity
 * - İlk kez: (ECDSA + ECDH) keypair üretir, private jwk'leri password ile encrypt edip IDB'ye yazar,
 *   public jwk'leri döner (server'a register edeceksin).
 * - Daha önce varsa: password ile decrypt edip CryptoKey'e import eder.
 *
 * Return:
 * { deviceId, pub: {signPubJwk, dhPubJwk}, priv: {signPrivateKey, dhPrivateKey}, isNew }
 */
export async function initE2EEIdentity({ password, deviceId }) {
  const did = validateDeviceId(deviceId);

  const pw = String(password ?? "").normalize("NFKC");
  if (!pw) throw new Error("E2EE_PASSWORD_REQUIRED");

  let existing = null;

  try {
    existing = await loadDecryptedIdentityRecord(pw);
  } catch (e) {
    if (String(e?.message) === "E2EE_PIN_INVALID_OR_RECORD_CORRUPTED") {
      await idbDelete(RECORD_KEY);
      existing = null;
    } else {
      throw e;
    }
  }

  if (existing) {
    const priv = await importKeysFromJwks(existing.privJwks);
    return {
      deviceId: existing.deviceId,
      pub: existing.pubJwks,
      priv,
      isNew: false,
    };
  }

  const pairs = await generateIdentityKeyPairs();
  const pubJwks = await exportPublicJwks(pairs);
  const privJwks = await exportPrivateJwks(pairs);

  await storeEncryptedIdentityRecord({ password: pw, deviceId: did, privJwks, pubJwks });

  const priv = await importKeysFromJwks(privJwks);

  return {
    deviceId: did,
    pub: pubJwks,
    priv,
    isNew: true,
  };
}

export async function rewrapIdentity({ oldPin, newPin }) {
  const oldPw = String(oldPin ?? "").normalize("NFKC");
  const newPw = String(newPin ?? "").normalize("NFKC");
  if (!oldPw) throw new Error("OLD_PIN_REQUIRED");
  if (!newPw) throw new Error("NEW_PIN_REQUIRED");
  if (oldPw === newPw) {
    const record = await getEncryptedIdentityRecord();
    return record;
  }

  const existing = await loadDecryptedIdentityRecord(oldPw);
  if (!existing?.privJwks || !existing?.pubJwks) {
    throw new Error("IDENTITY_RECORD_MISSING");
  }

  await storeEncryptedIdentityRecord({
    password: newPw,
    deviceId: existing.deviceId,
    privJwks: existing.privJwks,
    pubJwks: existing.pubJwks
  });

  return getEncryptedIdentityRecord();
}

export async function getEncryptedIdentityRecord() {
  const record = await idbGet(RECORD_KEY);
  return record ?? null;
}

export async function setEncryptedIdentityRecord(record) {
  // server’dan çektiğin record’u IDB’ye yazmak için
  if (!record || record.v !== 1) throw new Error("E2EE_IDENTITY_INVALID_RECORD");
  if (!record.kdf?.salt_b64 || !record.enc?.iv_b64 || !record.enc?.ct_b64) {
    throw new Error("E2EE_IDENTITY_INVALID_RECORD_FIELDS");
  }

  // updatedAt yoksa ekleyelim
  const now = new Date().toISOString();
  const safe = {
    ...record,
    updatedAt: record.updatedAt || now,
    createdAt: record.createdAt || now,
  };

  await idbPut(RECORD_KEY, safe);
  return true;
}