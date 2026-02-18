import { initials, escapeHtml, fmtTime } from "./helpers.js";

export function renderInbox(state, q) {
    const { list, search } = state.els;
    const query = (q ?? search.value ?? "").toLowerCase().trim();

    const filtered = state.INBOX.filter(c =>
        (c.peerUsername || "").toLowerCase().includes(query)
    );

    if (!filtered.length) {
        list.innerHTML = `<div style="padding:12px;opacity:.7">Henüz konuşma yok</div>`;
        return;
    }

    list.innerHTML = filtered.map(c => `
    <button class="cw-item" data-peer="${c.peerId}">
      <div class="cw-av">${initials(c.peerUsername)}</div>

      <div class="cw-meta">
        <div class="cw-top">
          <div class="n">${escapeHtml(c.peerUsername)}</div>
          ${c.unreadCount > 0 ? `<span class="cw-badge">${c.unreadCount}</span>` : ""}
        </div>
        <div class="p">${escapeHtml(c.lastMessage || "")}</div>
      </div>

      <div class="cw-time">${fmtTime(c.lastSentAt)}</div>
    </button>
  `).join("");
}

export function renderUserResults(state, arr) {
    const { list } = state.els;

    if (!arr.length) {
        list.innerHTML = `<div style="padding:12px;opacity:.7">Kullanıcı bulunamadı</div>`;
        return;
    }

    list.innerHTML = arr.map(u => `
    <button class="cw-item" data-peer="${u.id}" data-username="${escapeHtml(u.username)}">
      <div class="cw-av">${initials(u.username)}</div>
      <div class="cw-meta">
        <div class="n">${escapeHtml(u.username)}</div>
        <div class="p">Yeni sohbet başlat</div>
      </div>
    </button>
  `).join("");
}