/**
 * app_common.js — funzioni condivise dell'App Trasferte
 *  - mostra gli errori in modo visibile (non più solo nella console del browser);
 *  - interpreta correttamente gli importi in formato italiano e rifiuta quelli non validi.
 */

// ── Pannello di errore visibile ─────────────────────────────────────────
window.showAppError = function(error) {
    const old = document.getElementById('app-error-panel');
    if (old) old.remove();
    const panel = document.createElement('div');
    panel.id = 'app-error-panel';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'position:fixed;top:12px;left:12px;right:12px;z-index:10000;max-width:640px;margin:0 auto;background:#fff2f1;color:#74251f;border:2px solid #c75b4c;border-radius:12px;padding:16px 18px;box-shadow:0 6px 28px rgba(0,0,0,0.18);font:15px/1.5 system-ui,sans-serif';
    const msg = document.createElement('p');
    msg.style.cssText = 'margin:0 0 10px 0;font-weight:600';
    msg.textContent = (error && error.message) ? error.message : String(error || 'Operazione non riuscita.');
    panel.appendChild(msg);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Chiudi';
    close.style.cssText = 'padding:8px 14px;border:1px solid currentColor;border-radius:6px;background:white;color:#74251f;font-weight:700;cursor:pointer';
    close.onclick = () => panel.remove();
    panel.appendChild(close);
    document.body.appendChild(panel);
};

// Intercetta gli errori asincroni non gestiti e li rende visibili.
window.addEventListener('unhandledrejection', function(e) {
    e.preventDefault();
    window.showAppError(e.reason);
});

// ── Interpretazione degli importi in euro ───────────────────────────────
// Accetta: 12,50 · 1.234,56 · 1234.56 · 1,234.56 · 8 · "€ 45,00"
// Rifiuta input palesemente non validi (es. "abc", "12,,5").
window.parseImporto = function(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    let s = String(value ?? '').trim().replace(/\s|€|euro/gi, '');
    if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');      // 1.234,56
    else if (/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, '');                       // 1,234.56
    else if (/^-?\d+([,.]\d{1,2})?$/.test(s)) s = s.replace(',', '.');                                  // 12,50 · 1234.56 · 8
    else throw new Error('Importo non valido. Scrivilo ad esempio come 12,50 oppure 1.234,56.');
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error('Importo non valido.');
    return n;
};

// Versione tollerante per i TOTALI/visualizzazione: stessa interpretazione di
// parseImporto, ma restituisce 0 su valori non interpretabili (non solleva errori),
// così un singolo dato vecchio non valido non blocca il calcolo dei totali.
window.importoNumero = function(value) {
    try { return window.parseImporto(value); }
    catch (_) { return 0; }
};

// ── Estensione file a partire dal tipo MIME (per lo ZIP e il download) ───
window.estensioneDaMime = function(mime) {
    return ({
        'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
        'image/gif': 'gif', 'image/bmp': 'bmp', 'image/avif': 'avif',
        'image/heic': 'heic', 'image/heif': 'heif', 'image/tiff': 'tif', 'application/pdf': 'pdf'
    })[String(mime || '').split(';')[0].trim().toLowerCase()] || 'bin';
};
