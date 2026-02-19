// ======== Config (Java'daki sabitlerin JS karşılığı) ========
const AES_ALGORITHM = "AES-GCM";
const SHA_CRYPT = "SHA-256";

// Java'daki IV_LENGTH_ENCRYPT (bytes). AES-GCM için 12 byte önerilir.
const IV_LENGTH_ENCRYPT = 12;

// Java'daki TAG_LENGTH_ENCRYPT (bytes). WebCrypto'da default 128-bit (16 byte).
const TAG_LENGTH_ENCRYPT = 16; // 16 bytes = 128-bit

// Java'daki LOCAL_PASSPHRASE
const LOCAL_PASSPHRASE = "YOUR_LOCAL_PASSPHRASE_HERE";

// ======== Helpers ========
const te = new TextEncoder();
const td = new TextDecoder();

function concatUint8(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

function bytesToBase64(bytes) {
    // Browser-safe Base64
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function base64ToBytes(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

async function sha256Bytes(dataBytes) {
    const hashBuf = await crypto.subtle.digest(SHA_CRYPT, dataBytes);
    return new Uint8Array(hashBuf);
}

async function generateAesKeyFromPassphrase(passphrase) {
    // Java: SHA-256(passphrase UTF-8) => 32 byte key
    const passBytes = te.encode(passphrase);
    const keyBytes = await sha256Bytes(passBytes);

    return crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: AES_ALGORITHM },
        false, // extractable
        ["encrypt", "decrypt"]
    );
}

// ======== API: localEncrypt / localDecrypt ========
async function localEncrypt(plainText, passphrase = LOCAL_PASSPHRASE) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_ENCRYPT));
    const key = await generateAesKeyFromPassphrase(passphrase);

    const encryptedBuf = await crypto.subtle.encrypt(
        {
            name: AES_ALGORITHM,
            iv,
            tagLength: TAG_LENGTH_ENCRYPT * 8, // bits
        },
        key,
        te.encode(plainText)
    );

    const encryptedBytes = new Uint8Array(encryptedBuf);

    // Java: IV + encryptedBytes (encryptedBytes içinde tag sonda bulunur)
    const combined = concatUint8(iv, encryptedBytes);
    return bytesToBase64(combined);
}

async function localDecrypt(cipherTextB64, passphrase = LOCAL_PASSPHRASE) {
    const combined = base64ToBytes(cipherTextB64);

    const iv = combined.slice(0, IV_LENGTH_ENCRYPT);
    const encryptedBytes = combined.slice(IV_LENGTH_ENCRYPT);

    const key = await generateAesKeyFromPassphrase(passphrase);

    const decryptedBuf = await crypto.subtle.decrypt(
        {
            name: AES_ALGORITHM,
            iv,
            tagLength: TAG_LENGTH_ENCRYPT * 8,
        },
        key,
        encryptedBytes
    );

    return td.decode(decryptedBuf);
}

// ======== Quick test ========
(async () => {
    const enc = await localEncrypt("merhaba");
    console.log("enc:", enc);
    const dec = await localDecrypt(enc);
    console.log("dec:", dec);
})();