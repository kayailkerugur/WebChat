export function closeCtxMenu(state) {
    if (state.ctxMenuEl) {
        state.ctxMenuEl.remove();
        state.ctxMenuEl = null;
    }
}

export function openCtxMenu(state, { x, y, isMine, onDeleteMe, onDeleteAll }) {
    closeCtxMenu(state);

    const menu = document.createElement("div");
    menu.className = "cw-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const delMe = document.createElement("button");
    delMe.innerHTML = `Benim için sil <span class="muted">(sadece sende)</span>`;
    delMe.onclick = () => {
        closeCtxMenu(state);
        onDeleteMe?.();
    };
    menu.appendChild(delMe);

    if (isMine) {
        const delAll = document.createElement("button");
        delAll.className = "danger";
        delAll.innerHTML = `Herkes için sil <span class="muted">(mesaj silindi)</span>`;
        delAll.onclick = () => {
            closeCtxMenu(state);
            onDeleteAll?.();
        };
        menu.appendChild(delAll);
    }

    document.body.appendChild(menu);

    const r = menu.getBoundingClientRect();
    let nx = x, ny = y;
    if (r.right > window.innerWidth) nx = window.innerWidth - r.width - 8;
    if (r.bottom > window.innerHeight) ny = window.innerHeight - r.height - 8;
    menu.style.left = `${Math.max(8, nx)}px`;
    menu.style.top = `${Math.max(8, ny)}px`;

    state.ctxMenuEl = menu;
}