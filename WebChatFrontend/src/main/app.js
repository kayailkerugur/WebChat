import CryptoJS from "https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/+esm";

const inputText = document.getElementById("inputText");
const lenText = document.getElementById("lenText");
const statusText = document.getElementById("statusText");

// Tabs
const tabHash = document.getElementById("tabHash");
const tabBase64 = document.getElementById("tabBase64");
const panelHash = document.getElementById("panelHash");
const panelBase64 = document.getElementById("panelBase64");
const hintText = document.getElementById("hintText");

// Hash buttons
const btnSHA256 = document.getElementById("btnSHA256");
const btnMD5 = document.getElementById("btnMD5");
const optUppercase = document.getElementById("optUppercase");
const optTrim = document.getElementById("optTrim");

// Base64 buttons
const btnB64Encode = document.getElementById("btnB64Encode");
const btnB64Decode = document.getElementById("btnB64Decode");
const optUrlSafe = document.getElementById("optUrlSafe");
const optNoPadding = document.getElementById("optNoPadding");

// Outputs
const outSHA256 = document.getElementById("outSHA256");
const outMD5 = document.getElementById("outMD5");
const outB64 = document.getElementById("outB64");

// Copy buttons
const btnCopySHA256 = document.getElementById("btnCopySHA256");
const btnCopyMD5 = document.getElementById("btnCopyMD5");
const btnCopyB64 = document.getElementById("btnCopyB64");
const btnCopyAll = document.getElementById("btnCopyAll");

// Helpers
const btnClear = document.getElementById("btnClear");
const btnPaste = document.getElementById("btnPaste");

// Toast
const toast = document.getElementById("toast");
const toastText = document.getElementById("toastText");

// ===============================
// INIT
// ===============================

document.addEventListener("DOMContentLoaded", () => {
    updateLength();
    setStatus("Hazır.");
});

// ===============================
// EVENT LISTENERS
// ===============================

// Input length update
inputText.addEventListener("input", updateLength);

// Tabs
tabHash.addEventListener("click", () => switchTab("hash"));
tabBase64.addEventListener("click", () => switchTab("base64"));

// Hash
btnSHA256.addEventListener("click", handleSHA256);
btnMD5.addEventListener("click", handleMD5);

// Base64
btnB64Encode.addEventListener("click", handleBase64Encode);
btnB64Decode.addEventListener("click", handleBase64Decode);

// Copy
btnCopySHA256.addEventListener("click", () => copyText(outSHA256.value));
btnCopyMD5.addEventListener("click", () => copyText(outMD5.value));
btnCopyB64.addEventListener("click", () => copyText(outB64.value));
btnCopyAll.addEventListener("click", copyAllOutputs);

// Clear / Paste
btnClear.addEventListener("click", clearAll);
btnPaste.addEventListener("click", pasteFromClipboard);

// ===============================
// TAB SWITCHING
// ===============================

function switchTab(tab) {
    if (tab === "hash") {
        panelHash.classList.remove("hidden");
        panelBase64.classList.add("hidden");

        tabHash.classList.add("active");
        tabBase64.classList.remove("active");

        hintText.textContent = "Hash üretmek için bir algoritma seç.";
    } else {
        panelBase64.classList.remove("hidden");
        panelHash.classList.add("hidden");

        tabBase64.classList.add("active");
        tabHash.classList.remove("active");

        hintText.textContent = "Base64 encode veya decode işlemi yap.";
    }
}


// ===============================
// HASH HANDLERS
// ===============================

async function handleSHA256() {
    let text = prepareInput();

    if (text) {
        sha256(text).then(result => {
            result = applyOutputFormatting(result);

            outSHA256.value = result;

            setStatus("SHA-256 üretildi.");
        });
    } else {
        clearAll();
    }
}

function handleMD5() {
    let text = prepareInput();
    if (text) {
        let result = applyOutputFormatting(generateMD5(text));

        outMD5.value = result;

        setStatus("MD5 üretildi.");
    } else {
        clearAll();
    }
}

// ===============================
// BASE64 HANDLERS
// ===============================

function handleBase64Encode() {
    let text = prepareInput();

    if (text) {
        let result = base64EncodeUtf8(text);

        if (optUrlSafe.checked) {
            result = result.replace(/\+/g, "-").replace(/\//g, "_");
        }

        if (optNoPadding.checked) {
            result = result.replace(/=+$/g, "");
        }

        outB64.value = result;
        setStatus("Base64 encode tamamlandı.");
    } else {
        clearAll();
    }
}

function handleBase64Decode() {
    let text = prepareInput();

    if (text) {
        let b64 = text;

        if (optUrlSafe.checked) {
            b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
        }

        if (b64.length % 4 !== 0) {
            b64 += "=".repeat(4 - (b64.length % 4));
        }

        let result = base64DecodeUtf8(b64);

        outB64.value = result;
        setStatus("Base64 decode tamamlandı.");
    } else {
        clearAll();
    }
}

// ===============================
// HELPERS
// ===============================

function prepareInput() {
    let text = inputText.value;

    if (optTrim.checked) {
        text = text.trim();
    }

    return text;
}

function applyOutputFormatting(text) {
    if (optUppercase.checked) {
        return text.toUpperCase();
    }
    return text;
}

function updateLength() {
    lenText.textContent = inputText.value.length;
}

function setStatus(message) {
    statusText.textContent = message;
}

async function copyText(text) {
    if (!text) return;

    try {
        await navigator.clipboard.writeText(text);
        showToast("Kopyalandı!");
    } catch (err) {
        setStatus("Kopyalama başarısız.");
    }
}

function copyAllOutputs() {
    const combined = `
SHA-256:
${outSHA256.value}

MD5:
${outMD5.value}

Base64:
${outB64.value}
  `.trim();

    copyText(combined);
}

function clearAll() {
    inputText.value = "";
    outSHA256.value = "";
    outMD5.value = "";
    outB64.value = "";
    updateLength();
    setStatus("Temizlendi.");
}

async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        inputText.value = text;
        updateLength();
        setStatus("Yapıştırıldı.");
    } catch (err) {
        setStatus("Yapıştırma başarısız.");
    }
}

function showToast(message) {
    toastText.textContent = message;
    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");
    }, 1200);
}


async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);

    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);

    const hashArray = Array.from(new Uint8Array(hashBuffer));

    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

function generateMD5(text) {
    return CryptoJS.MD5(text).toString();
}

function base64EncodeUtf8(str) {
    const utf8Bytes = new TextEncoder().encode(str);
    let binary = "";
    for (let i = 0; i < utf8Bytes.length; i++) binary += String.fromCharCode(utf8Bytes[i]);
    return btoa(binary);
}

function base64DecodeUtf8(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}
