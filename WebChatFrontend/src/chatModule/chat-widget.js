// chat-widget.js
// Bu dosya, chat-widget.html DOM'a eklendikten sonra initChatWidget() çağrılınca çalışır.

function initChatWidget() {
  // Eğer aynı widget birden fazla kez init edilirse eventler çakışmasın
  const root = document.getElementById("cw");
  if (!root) {
    console.warn("[chat-widget] #cw bulunamadı. HTML yüklenmemiş olabilir.");
    return;
  }
  if (root.dataset.initialized === "true") return;
  root.dataset.initialized = "true";

  const fab = document.getElementById("cwFab");

  const people = document.getElementById("cwPeople");
  const chat = document.getElementById("cwChat");

  const closePeople = document.getElementById("cwClosePeople");
  const closeChat = document.getElementById("cwCloseChat");
  const backBtn = document.getElementById("cwBack");

  const list = document.getElementById("cwList");
  const search = document.getElementById("cwSearch");

  const nameEl = document.getElementById("cwName");
  const avatarEl = document.getElementById("cwAvatar");
  const subEl = document.getElementById("cwSub");

  const messages = document.getElementById("cwMessages");
  const form = document.getElementById("cwForm");
  const text = document.getElementById("cwText");

  // Kritik elemanlar yoksa çalıştırma
  const required = { fab, people, chat, closePeople, closeChat, backBtn, list, search, nameEl, avatarEl, subEl, messages, form, text };
  const missing = Object.entries(required).filter(([_, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error("[chat-widget] Eksik elementler:", missing);
    return;
  }

  // ÖRNEK kişi listesi
  const PEOPLE = [
    { id: "u1", name: "Ahmet Yılmaz", status: "Çevrimiçi", preview: "Merhaba, müsait misin?" },
    { id: "u2", name: "Elif Kara", status: "Son görülme: 10 dk", preview: "Dosyayı attım." },
    { id: "u3", name: "Mert Demir", status: "Çevrimdışı", preview: "Yarın konuşuruz." },
  ];

  // Basit local mesaj saklama
  const threads = new Map(); // id -> [{from:"me/them", text, ts}]
  let currentId = null;

  function openPeople() {
    chat.classList.remove("open");
    chat.setAttribute("aria-hidden", "true");

    people.classList.add("open");
    people.setAttribute("aria-hidden", "false");

    search.value = "";
    renderPeople("");
    setTimeout(() => search.focus(), 0);
  }

  function closeAll() {
    people.classList.remove("open");
    people.setAttribute("aria-hidden", "true");

    chat.classList.remove("open");
    chat.setAttribute("aria-hidden", "true");
  }

  function openChat(personId) {
    currentId = personId;
    const p = PEOPLE.find(x => x.id === personId);
    if (!p) return;

    nameEl.textContent = p.name;
    avatarEl.textContent = initials(p.name);
    subEl.textContent = p.status;

    people.classList.remove("open");
    people.setAttribute("aria-hidden", "true");

    chat.classList.add("open");
    chat.setAttribute("aria-hidden", "false");

    renderMessages();
    setTimeout(() => text.focus(), 0);
  }

  function initials(fullName) {
    return fullName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map(s => s[0].toUpperCase())
      .join("");
  }

  function renderPeople(q) {
    const query = (q || "").toLowerCase().trim();
    const filtered = PEOPLE.filter(p => p.name.toLowerCase().includes(query));

    list.innerHTML = filtered.map(p => `
      <button class="cw-item" data-id="${p.id}">
        <div class="cw-av">${initials(p.name)}</div>
        <div class="cw-meta">
          <div class="n">${p.name}</div>
          <div class="s">${p.status}</div>
          <div class="p">${p.preview || ""}</div>
        </div>
      </button>
    `).join("");

    list.querySelectorAll(".cw-item").forEach(btn => {
      btn.addEventListener("click", () => openChat(btn.dataset.id));
    });
  }

  function renderMessages() {
    const arr = threads.get(currentId) || [];
    messages.innerHTML = arr.map(m => `
      <div class="cw-msg ${m.from === "me" ? "me" : "them"}">${escapeHtml(m.text)}</div>
    `).join("");

    if (arr.length === 0) {
      messages.innerHTML = `<div class="cw-msg them">Merhaba! 👋</div>`;
    }

    messages.scrollTop = messages.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  // Events
  fab.addEventListener("click", (e) => {
    e.stopPropagation(); // dışarı click handler'ı kapatmasın
    const isOpen = people.classList.contains("open") || chat.classList.contains("open");
    if (isOpen) closeAll();
    else openPeople();
  });

  closePeople.addEventListener("click", (e) => { e.stopPropagation(); closeAll(); });
  closeChat.addEventListener("click", (e) => { e.stopPropagation(); closeAll(); });

  backBtn.addEventListener("click", (e) => { e.stopPropagation(); openPeople(); });

  search.addEventListener("input", (e) => renderPeople(e.target.value));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const value = text.value.trim();
    if (!value || !currentId) return;

    const arr = threads.get(currentId) || [];
    arr.push({ from: "me", text: value, ts: Date.now() });
    threads.set(currentId, arr);

    text.value = "";
    renderMessages();

    // demo reply
    setTimeout(() => {
      const arr2 = threads.get(currentId) || [];
      arr2.push({ from: "them", text: "Gördüm 👍", ts: Date.now() });
      threads.set(currentId, arr2);
      renderMessages();
    }, 400);
  });

  // Widget içinde tıklayınca dış click kapatmasın
  root.addEventListener("click", (e) => e.stopPropagation());

  // dışarı tıklayınca kapat
  document.addEventListener("click", () => {
    closeAll();
  });

  // ilk render
  renderPeople("");
}

// Eğer widget HTML'i sayfada zaten duruyorsa (fetch kullanmıyorsan) otomatik başlat
document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("cw")) {
    initChatWidget();
  }
});