/**
 * driveStorage.js — App Trasferte (uso personale)
 * Salva dati e foto nella cartella visibile "App Trasferte" sul Google Drive personale.
 * Scope: https://www.googleapis.com/auth/drive.file (vede solo i file creati dall'app).
 *
 * Correzioni rispetto alla versione iniziale:
 *  - ogni risposta di Google viene controllata: se l'operazione è rifiutata, l'app lo segnala (niente falso "salvato");
 *  - una lettura fallita o un file illeggibile NON diventano un archivio vuoto che sovrascrive i dati;
 *  - controllo di versione leggero: prima di salvare si rilegge il file e, se è cambiato
 *    da un altro dispositivo, il salvataggio viene rifiutato con avviso (niente perdita silenziosa);
 *  - le foto vengono salvate a piena risoluzione (nessuna riduzione a 800 px);
 *  - il token di accesso resta in localStorage: si resta collegati finché si preme "Esci"
 *    o finché Google non lo fa scadere (circa un'ora).
 */

// Utility XSS: sanifica stringhe prima di inserirle in HTML
window.esc = function(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
};

class DriveStorage {
    constructor() {
        this.APP_FOLDER_NAME = 'App Trasferte';
        this.DATA_FILE_NAME  = 'stitch_data.json';
        this._cache       = null;
        this._baseline    = null;   // istantanea JSON dei dati al momento del caricamento (per rilevare conflitti)
        this._loading     = null;
        this._appFolderId = null;
        this._dataFileId  = null;
    }

    _getToken() { return localStorage.getItem('googleAccessToken'); }

    _emptyData() { return { trasferte: [], giustificativi: {}, settings: {}, customCategories: [] }; }
    _copy(d) { return JSON.parse(JSON.stringify(d)); }
    _quote(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

    // ── Chiamata a Drive con controllo degli errori ─────────────────────
    async _request(url, options = {}) {
        const token = this._getToken();
        if (!token) { this._forceLogin(); throw new Error('Accesso Google necessario. Effettua di nuovo l’accesso.'); }
        let res;
        try {
            res = await fetch(url, { ...options, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
        } catch (_) {
            throw new Error('Connessione non disponibile. Nessun salvataggio è stato confermato: mantieni aperta la pagina e riprova.');
        }
        if (res.status === 401) { this._forceLogin(); throw new Error('Accesso Google scaduto. Effettua di nuovo l’accesso e riprova.'); }
        if (!res.ok) {
            let reason = '';
            try { reason = (await res.json())?.error?.message || ''; } catch (_) {}
            throw new Error(`Google Drive ha rifiutato l’operazione (${res.status}). ${reason} Nessun salvataggio è stato confermato.`.trim());
        }
        return res;
    }

    _forceLogin() {
        localStorage.removeItem('googleAccessToken');
        localStorage.removeItem('userLoggedIn');
        if (!/login\.html$/.test(location.pathname)) location.href = 'login.html';
    }

    // ── Elenco file (gestisce la paginazione) ───────────────────────────
    async _list(q, fields = 'id,name') {
        const params = new URLSearchParams({ q, fields: `files(${fields})`, spaces: 'drive', pageSize: '1000' });
        const data = await (await this._request(`https://www.googleapis.com/drive/v3/files?${params}`)).json();
        if (!Array.isArray(data.files)) throw new Error('Risposta di Drive non valida. Operazione interrotta.');
        return data.files;
    }

    // ── Cartella "App Trasferte" (creata se non esiste) ──────────────────
    async _getAppFolderId() {
        if (this._appFolderId) return this._appFolderId;
        const q = `name='${this._quote(this.APP_FOLDER_NAME)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const files = await this._list(q);
        if (files.length) return this._appFolderId = files[0].id;
        const data = await (await this._request('https://www.googleapis.com/drive/v3/files?fields=id', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: this.APP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
        })).json();
        if (!data.id) throw new Error('Creazione della cartella non confermata da Drive.');
        return this._appFolderId = data.id;
    }

    // ── Sottocartella visibile per la trasferta ─────────────────────────
    async _getTripFolderId(tripName) {
        const parentId = await this._getAppFolderId();
        const safe = String(tripName).replace(/[\/\\:*?"<>|]/g, '_');
        const q = `name='${this._quote(safe)}' and mimeType='application/vnd.google-apps.folder' and '${this._quote(parentId)}' in parents and trashed=false`;
        const files = await this._list(q);
        if (files.length) return files[0].id;
        const data = await (await this._request('https://www.googleapis.com/drive/v3/files?fields=id', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: safe, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
        })).json();
        if (!data.id) throw new Error('Creazione della cartella non confermata da Drive.');
        return data.id;
    }

    // ── Individua il file dati (null se non esiste ancora) ──────────────
    async _findDataFile() {
        const folderId = await this._getAppFolderId();
        const files = await this._list(`name='${this._quote(this.DATA_FILE_NAME)}' and '${this._quote(folderId)}' in parents and trashed=false`);
        if (files.length > 1) throw new Error('Trovati più archivi "stitch_data.json" su Drive. Per sicurezza il salvataggio è sospeso: verifica le copie prima di continuare.');
        return this._dataFileId = (files[0]?.id || null);
    }

    _validate(data) {
        const ok = data && typeof data === 'object' && !Array.isArray(data)
            && Array.isArray(data.trasferte)
            && data.giustificativi && typeof data.giustificativi === 'object' && !Array.isArray(data.giustificativi)
            && data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)
            && Array.isArray(data.customCategories);
        if (!ok) throw new Error('L’archivio su Drive non è in un formato valido. Caricamento interrotto per non mettere a rischio i dati esistenti.');
        return data;
    }

    // ── Legge l'archivio dal Drive (senza cache) ────────────────────────
    async _readRemote() {
        const id = await this._findDataFile();
        if (!id) return { id: null, data: this._emptyData() };
        const res = await this._request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
        let data;
        try { data = await res.json(); }
        catch (_) { throw new Error('L’archivio su Drive è risultato illeggibile. I dati esistenti non verranno sovrascritti. Riprova.'); }
        return { id, data: this._validate(data) };
    }

    // ── Carica i dati in cache (una sola volta) ─────────────────────────
    async loadData() {
        if (this._cache) return this._cache;
        if (!this._loading) this._loading = (async () => {
            const remote = await this._readRemote();
            this._cache = remote.data;
            this._baseline = JSON.stringify(remote.data);
            return this._cache;
        })().finally(() => { this._loading = null; });
        return this._loading;
    }

    invalidateCache() { this._cache = null; this._baseline = null; this._appFolderId = null; this._dataFileId = null; }
    async refresh() { this.invalidateCache(); return this.loadData(); }

    // ── Carica un file su Drive (multipart) ─────────────────────────────
    async _upload(name, blob, parentId, existingId = null) {
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify({ name, ...(existingId ? {} : { parents: [parentId] }) })], { type: 'application/json' }));
        form.append('file', blob, name);
        const res = await this._request(
            `https://www.googleapis.com/upload/drive/v3/files${existingId ? '/' + encodeURIComponent(existingId) : ''}?uploadType=multipart&fields=id,webViewLink,name,mimeType`,
            { method: existingId ? 'PATCH' : 'POST', body: form }
        );
        const result = await res.json();
        if (!result.id) throw new Error('Drive non ha confermato il file salvato. Controlla l’archivio prima di riprovare.');
        return result;
    }

    // ── Salva l'archivio con controllo di conflitto ─────────────────────
    async _persist() {
        // Rilegge lo stato attuale su Drive: se è cambiato dal caricamento, un altro dispositivo
        // ha salvato nel frattempo e NON sovrascriviamo.
        const remote = await this._readRemote();
        if (JSON.stringify(remote.data) !== this._baseline) {
            this.invalidateCache();
            throw new Error('L’archivio è stato modificato da un altro dispositivo o da un’altra scheda. La tua modifica NON è stata salvata: conserva i valori inseriti, ricarica la pagina e riprova.');
        }
        const folderId = await this._getAppFolderId();
        const content = JSON.stringify(this._validate(this._cache));
        const blob = new Blob([content], { type: 'application/json' });
        const saved = await this._upload(this.DATA_FILE_NAME, blob, folderId, remote.id);
        this._dataFileId = saved.id;
        this._baseline = content;   // nuovo riferimento per i salvataggi successivi
    }

    // Applica una modifica alla cache e salva; in caso di errore invalida la cache.
    async _mutate(change) {
        const data = await this.loadData();
        change(data);
        try { await this._persist(); }
        catch (e) { this.invalidateCache(); throw e; }
    }

    // ── CRUD Trasferte ──────────────────────────────────────────────────
    async getTrasferte()        { return (await this.loadData()).trasferte; }
    async saveTrasferte(t)      { return this._mutate(d => { d.trasferte = t; }); }

    // ── CRUD Giustificativi ─────────────────────────────────────────────
    async getGiustificativi(id)      { return (await this.loadData()).giustificativi[id] || []; }
    async saveGiustificativi(id, g)  { return this._mutate(d => { if (!d.giustificativi) d.giustificativi = {}; d.giustificativi[id] = g; }); }
    async deleteGiustificativiTrasferta(id) { return this._mutate(d => { if (d.giustificativi) delete d.giustificativi[id]; }); }

    // ── Settings ────────────────────────────────────────────────────────
    async getSettings()   { return (await this.loadData()).settings || {}; }
    async saveSettings(s) { return this._mutate(d => { d.settings = s; }); }

    // ── Categorie custom ────────────────────────────────────────────────
    async getCustomCategories()   { return (await this.loadData()).customCategories || []; }
    async saveCustomCategories(c) { return this._mutate(d => { d.customCategories = c; }); }

    // ── Salva foto su Drive (piena risoluzione, nessuna compressione) ───
    async savePhotoToDrive(source, tripName, filename) {
        const blob = source instanceof Blob ? source : await (await fetch(source)).blob();
        if (!blob.size) throw new Error('Il file della foto è vuoto.');
        const folderId = await this._getTripFolderId(tripName);
        const result = await this._upload(filename, blob, folderId);
        return {
            id: result.id,
            url: result.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(result.id)}/view`
        };
    }

    // ── Recupera foto come Blob (per la visualizzazione) ────────────────
    async getPhotoBlob(fileId) {
        if (!fileId) throw new Error('Riferimento alla foto mancante.');
        const res = await this._request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
        const blob = await res.blob();
        if (!blob.size) throw new Error('Il file recuperato da Drive è vuoto.');
        return blob;
    }

    // ── Recupera foto come base64 (per lo ZIP) ──────────────────────────
    async getPhotoBase64(fileId) {
        const blob = await this.getPhotoBlob(fileId);
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Lettura della foto non riuscita.'));
            reader.readAsDataURL(blob);
        });
    }
}

window.driveStorage = new DriveStorage();
