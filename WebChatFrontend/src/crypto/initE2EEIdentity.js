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

async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const store = tx.objectStore(STORE);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
    });
}

async function idbPut(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const req = store.put(value, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
    });
}

// ---------- KDF + AES-GCM ----------
async function deriveKekFromPassword(password, salt) {
    // KEK = private key’leri şifrelemek için türetilen anahtar
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
    // Signing key pair (ECDSA)
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

    const record = {
        v: 1,
        deviceId,
        kdf: { alg: "PBKDF2", hash: KDF_HASH, iter: KDF_ITER, salt_b64: b64(salt) },
        enc: { alg: AES, iv_b64: b64(iv), ct_b64: b64(ct) },
        createdAt: new Date().toISOString(),
    };

    await idbPut(RECORD_KEY, record);
}

async function loadDecryptedIdentityRecord(password) {
    const record = await idbGet(RECORD_KEY);
    if (!record) return null;
    if (record.v !== 1) throw new Error("Unsupported identity record version");

    const salt = unb64(record.kdf.salt_b64);
    const iv = unb64(record.enc.iv_b64);
    const ct = unb64(record.enc.ct_b64);

    const kek = await deriveKekFromPassword(password, salt);
    const ptBytes = await aesGcmDecrypt(kek, iv, ct);

    return JSON.parse(td.decode(ptBytes)); // { deviceId, privJwks, pubJwks }
}

// ---------- Public API: init identity ----------
export async function initE2EEIdentity({ password, deviceId }) {
    const existing = await loadDecryptedIdentityRecord(password);
    if (existing) {
        const priv = await importKeysFromJwks(existing.privJwks);
        return {
            deviceId: existing.deviceId,
            pub: existing.pubJwks,   // server’a gönderilecek public keys
            priv,                    // client’te kullanılacak private keys (CryptoKey)
            isNew: false,
        };
    }

    const pairs = await generateIdentityKeyPairs();
    const pubJwks = await exportPublicJwks(pairs);
    const privJwks = await exportPrivateJwks(pairs);

    await storeEncryptedIdentityRecord({ password, deviceId, privJwks, pubJwks });

    const priv = await importKeysFromJwks(privJwks);

    return {
        deviceId,
        pub: pubJwks,
        priv,
        isNew: true,
    };
}