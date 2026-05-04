/* =============================================
   GUNTER SERVICE - Document Extraction
   -------------------------------------------------
   Analiza imágenes de recibos y facturas vía
   Gemini Vision (proxy /api/document-extract).
   Persiste el original en IndexedDB y produce una
   sugerencia de tarea lista para tasks-service.
   ============================================= */

(function () {
    const DB_NAME = 'gunter_documents';
    const DB_VERSION = 1;
    const STORE = 'receipts';
    const MAX_FILE_MB = 12;
    const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
    const RESIZE_MAX = 1600;

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const s = db.createObjectStore(STORE, { keyPath: 'id' });
                    s.createIndex('companyId', 'companyId');
                    s.createIndex('dueDate', 'dueDate');
                    s.createIndex('createdAt', 'createdAt');
                    s.createIndex('taskId', 'taskId');
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    // ---------- Public: file validation ----------
    function validateFile(file) {
        if (!file) throw new Error('No se recibió archivo.');
        if (!ACCEPTED.some(t => file.type === t)) {
            throw new Error(`Formato no soportado (${file.type}). Usa JPG, PNG, WebP, HEIC o PDF.`);
        }
        const mb = file.size / (1024 * 1024);
        if (mb > MAX_FILE_MB) {
            throw new Error(`Archivo demasiado grande: ${mb.toFixed(1)} MB (máx ${MAX_FILE_MB}).`);
        }
        return true;
    }

    // ---------- Resize image client-side ----------
    async function shrinkIfNeeded(file) {
        // PDF: lo dejamos pasar sin resize (solo primera página es usable por Gemini; MVP)
        if (file.type === 'application/pdf') {
            return { blob: file, mimeType: 'application/pdf' };
        }
        const bitmap = await createImageBitmap(file).catch(() => null);
        if (!bitmap) return { blob: file, mimeType: file.type };

        const { width, height } = bitmap;
        const maxSide = Math.max(width, height);
        if (maxSide <= RESIZE_MAX && file.size < 1.5 * 1024 * 1024) {
            bitmap.close();
            return { blob: file, mimeType: file.type };
        }
        const ratio = RESIZE_MAX / maxSide;
        const w = Math.round(width * ratio);
        const h = Math.round(height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        const outBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
        return { blob: outBlob, mimeType: 'image/jpeg' };
    }

    async function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => {
                const result = r.result;
                const comma = result.indexOf(',');
                resolve(comma >= 0 ? result.slice(comma + 1) : result);
            };
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
        });
    }

    // ---------- Extraction ----------
    async function extractFromFile(file, opts = {}) {
        validateFile(file);
        const { blob, mimeType } = await shrinkIfNeeded(file);
        const base64 = await blobToBase64(blob);
        const result = await extractFromBase64(base64, mimeType, opts);
        // Attach original blob for later persistence
        result.__originalBlob = blob;
        result.__originalMime = mimeType;
        return result;
    }

    async function extractFromBase64(base64, mimeType, opts = {}) {
        if (!navigator.onLine) {
            throw new Error('Sin conexión. Conéctate para procesar el documento.');
        }
        const url = (window.GUNTER_CONFIG && window.GUNTER_CONFIG.PROXY_DOCUMENT_EXTRACT_URL)
            || '/api/document-extract';
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: base64,
                mimeType,
                hint: opts.hint || 'auto',
                locale: opts.locale || 'es-MX'
            })
        });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            if (resp.status === 503) {
                throw new Error('Gemini no está configurado en el servidor. Añade GEMINI_API_KEY en .env.');
            }
            if (resp.status === 429) {
                throw new Error('Demasiadas extracciones. Espera un minuto.');
            }
            throw new Error(`Extracción falló (HTTP ${resp.status}): ${txt.slice(0, 200)}`);
        }
        const data = await resp.json();
        if (!data.ok || !data.extracted) {
            throw new Error('La IA no devolvió datos válidos.');
        }
        return normalize(data.extracted);
    }

    // ---------- Normalization ----------
    function normalize(raw) {
        const out = {
            tipo: raw.tipo || 'otro',
            empresa: raw.empresa || {},
            valor: raw.valor || {},
            fecha_emision: normDate(raw.fecha_emision),
            fecha_vencimiento: normDate(raw.fecha_vencimiento),
            referencia: raw.referencia || {},
            conceptos: Array.isArray(raw.conceptos) ? raw.conceptos : [],
            metodo_pago_sugerido: raw.metodo_pago_sugerido || null,
            resumen: raw.resumen || '',
            confidence: raw.confidence || { overall: 0 },
            warnings: Array.isArray(raw.warnings) ? raw.warnings : []
        };
        // Numeric safety
        ['total', 'subtotal', 'impuestos'].forEach(k => {
            if (out.valor[k] != null && typeof out.valor[k] !== 'number') {
                const n = parseFloat(String(out.valor[k]).replace(/[^0-9.-]/g, ''));
                out.valor[k] = isNaN(n) ? null : n;
            }
        });
        if (out.valor.moneda) out.valor.moneda = String(out.valor.moneda).toUpperCase();
        return out;
    }

    function normDate(v) {
        if (!v) return null;
        // Already ISO
        if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
        // DD/MM/YYYY or DD-MM-YYYY
        const m = String(v).match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
        if (m) {
            const d = m[1].padStart(2, '0');
            const mo = m[2].padStart(2, '0');
            const y = m[3].length === 2 ? '20' + m[3] : m[3];
            return `${y}-${mo}-${d}`;
        }
        return null;
    }

    // ---------- IndexedDB persistence ----------
    async function saveOriginal(extracted, fileBlob) {
        if (!fileBlob) throw new Error('saveOriginal requiere blob');
        const id = `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const record = {
            id,
            createdAt: new Date().toISOString(),
            extracted,
            blob: fileBlob,
            companyId: extracted.empresa?.nit || null,
            dueDate: extracted.fecha_vencimiento || null,
            taskId: null,
            reminderId: null
        };
        const db = await openDB();
        await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite');
            t.objectStore(STORE).add(record);
            t.oncomplete = res; t.onerror = () => rej(t.error);
        });
        db.close();
        return { documentId: id };
    }

    async function linkTask(documentId, taskId) {
        const db = await openDB();
        const rec = await new Promise((res, rej) => {
            const r = db.transaction(STORE).objectStore(STORE).get(documentId);
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        });
        if (!rec) { db.close(); return; }
        rec.taskId = taskId;
        await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite');
            t.objectStore(STORE).put(rec);
            t.oncomplete = res; t.onerror = () => rej(t.error);
        });
        db.close();
    }

    async function get(documentId) {
        const db = await openDB();
        const rec = await new Promise((res, rej) => {
            const r = db.transaction(STORE).objectStore(STORE).get(documentId);
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        });
        db.close();
        return rec;
    }

    async function list({ tipo, from, to } = {}) {
        const db = await openDB();
        const all = await new Promise((res, rej) => {
            const r = db.transaction(STORE).objectStore(STORE).getAll();
            r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
        });
        db.close();
        return all.filter(r => {
            if (tipo && r.extracted?.tipo !== tipo) return false;
            if (from && r.createdAt < from) return false;
            if (to && r.createdAt > to) return false;
            return true;
        }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
          .map(r => ({
              id: r.id,
              createdAt: r.createdAt,
              empresa: r.extracted?.empresa?.nombre,
              tipo: r.extracted?.tipo,
              total: r.extracted?.valor?.total,
              moneda: r.extracted?.valor?.moneda,
              dueDate: r.dueDate,
              taskId: r.taskId
          }));
    }

    async function remove(documentId) {
        const db = await openDB();
        await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite');
            t.objectStore(STORE).delete(documentId);
            t.oncomplete = res; t.onerror = () => rej(t.error);
        });
        db.close();
    }

    // ---------- Suggest task from extraction ----------
    function buildSuggestedTask(ext) {
        const empresa = ext.empresa?.nombre || 'desconocido';
        const due = ext.fecha_vencimiento;
        const valorStr = ext.valor?.total != null
            ? ` (${fmtMoney(ext.valor.total, ext.valor.moneda)})`
            : '';
        const title = `Pagar ${empresa}${valorStr}`;

        const dueAt = due ? `${due}T09:00:00` : null;
        const priority = urgencyFromDueDate(due);

        const reference = ext.referencia?.numero_factura
            || ext.referencia?.codigo_pago
            || ext.referencia?.numero_cliente
            || null;

        let reminder = null;
        if (due) {
            const fireAt = new Date(dueAt);
            fireAt.setDate(fireAt.getDate() - 1);
            // Don't schedule reminders in the past
            if (fireAt.getTime() > Date.now()) {
                reminder = {
                    fireAt: fireAt.toISOString(),
                    title: `Recordatorio: vence pago de ${empresa}`
                };
            }
        }

        return {
            title,
            notes: ext.resumen || null,
            dueAt,
            priority,
            tags: ['pago', ext.tipo].filter(Boolean),
            people: [],
            source: 'document',
            meta: {
                amount: ext.valor?.total ?? null,
                currency: ext.valor?.moneda || null,
                reference,
                documentType: ext.tipo,
                companyId: ext.empresa?.nit || null,
                documentId: null // set tras saveOriginal
            },
            reminder
        };
    }

    function urgencyFromDueDate(iso) {
        if (!iso) return 'normal';
        const diff = (new Date(iso).getTime() - Date.now()) / 86_400_000;
        if (diff < 3) return 'urgent';
        if (diff < 7) return 'high';
        return 'normal';
    }

    function fmtMoney(n, currency) {
        try {
            return new Intl.NumberFormat('es-MX', {
                style: 'currency',
                currency: currency || 'COP',
                maximumFractionDigits: 0
            }).format(n);
        } catch {
            return `${n} ${currency || ''}`.trim();
        }
    }

    function formatConfirmation(ext, suggested) {
        const warns = (ext.warnings || []).length
            ? ` ⚠️ ${ext.warnings.join(' · ')}`
            : '';
        const fecha = suggested.dueAt
            ? new Date(suggested.dueAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
            : 'sin fecha';
        return `¿Creo la tarea "${suggested.title}" con vencimiento ${fecha}?${warns}`;
    }

    window.GunterDocumentService = {
        validateFile,
        extractFromFile,
        extractFromBase64,
        saveOriginal,
        linkTask,
        get,
        list,
        remove,
        buildSuggestedTask,
        formatConfirmation,
        fmtMoney
    };
})();
