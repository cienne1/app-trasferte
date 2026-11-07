/**
 * photoViewer.js — visualizzazione del giustificativo (funzione "Vedi foto").
 * La foto viene recuperata da Drive con il token dell'utente (nessuna condivisione pubblica).
 */
window.mostraFoto = async function(fileId) {
    if (!fileId) { window.showAppError(new Error('Questo giustificativo non ha una foto associata.')); return; }

    const existing = document.getElementById('photo-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('dialog');
    dialog.id = 'photo-dialog';
    dialog.style.cssText = 'width:96vw;max-width:1100px;height:92dvh;max-height:92dvh;padding:12px;border:0;border-radius:12px;background:#f8f9fa;color:#191c1d';

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding-bottom:10px';
    const heading = document.createElement('strong');
    heading.textContent = 'Giustificativo';
    toolbar.appendChild(heading);

    const area = document.createElement('div');
    area.style.cssText = 'overflow:auto;height:calc(100% - 60px);background:#ddd;text-align:center;touch-action:pan-x pan-y pinch-zoom';
    const status = document.createElement('p');
    status.textContent = 'Caricamento da Drive…';
    area.appendChild(status);

    let blobUrl = null, width = 100;
    const image = document.createElement('img');
    image.alt = 'Fotografia del giustificativo';
    image.style.cssText = 'display:block;width:100%;max-width:none;height:auto;margin:auto';

    const addBtn = (label, fn, disabled = false) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label; b.disabled = disabled;
        b.style.cssText = 'padding:8px 12px;background:white;border:1px solid #aaa;border-radius:6px;cursor:pointer';
        b.onclick = fn; toolbar.appendChild(b); return b;
    };
    addBtn('−', () => { width = Math.max(25, width - 25); image.style.width = width + '%'; });
    addBtn('+', () => { width = Math.min(500, width + 25); image.style.width = width + '%'; });
    addBtn('Adatta', () => { width = 100; image.style.width = '100%'; });
    const download = addBtn('Scarica originale', () => {}, true);
    addBtn('Apri su Drive', () => window.open(`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`, '_blank', 'noopener,noreferrer'));
    addBtn('Chiudi', () => dialog.close());

    dialog.append(toolbar, area);
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => { if (blobUrl) URL.revokeObjectURL(blobUrl); dialog.remove(); }, { once: true });
    dialog.showModal();

    try {
        const blob = await driveStorage.getPhotoBlob(fileId);
        if (!dialog.isConnected) return;
        blobUrl = URL.createObjectURL(blob);
        image.onerror = () => {
            area.replaceChildren();
            const p = document.createElement('p');
            p.style.cssText = 'padding:20px';
            p.textContent = 'Il browser non riesce a mostrare questo formato. Usa "Scarica originale" oppure "Apri su Drive".';
            area.appendChild(p);
        };
        image.src = blobUrl;
        area.replaceChildren(image);
        const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' })[(blob.type || '').split(';')[0]] || 'img';
        download.disabled = false;
        download.onclick = () => { const a = document.createElement('a'); a.href = blobUrl; a.download = `giustificativo_${fileId}.${ext}`; a.click(); };
    } catch (e) {
        dialog.close();
        window.showAppError(e);
    }
};
