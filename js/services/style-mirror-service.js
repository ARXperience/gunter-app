/* =============================================
   GUNTER SERVICE - Style Mirror (v2 — F5)
   -------------------------------------------------
   Cliente de /api/style-mirror.
   API:
     await GunterStyleMirror.buildFromMessages({contactKey, displayName, messages})
     await GunterStyleMirror.redact({contactKey, intent, context})
     await GunterStyleMirror.list()
     await GunterStyleMirror.get(contactKey)
     await GunterStyleMirror.remove(contactKey)
     await GunterStyleMirror.buildFromWhatsApp(contactKey)
       → recolecta automaticamente de WhatsApp messages outbound
   ============================================= */

(function () {
    if (window.GunterStyleMirror) return;

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('mirrorStyle')); }

    function url() {
        const c = window.GUNTER_CONFIG || {};
        return (c.PROXY_BASE_URL || 'http://localhost:3001') + '/api/style-mirror';
    }

    async function call(op, params = {}) {
        const resp = await fetch(url(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op, params })
        });
        if (!resp.ok) throw new Error('style-mirror HTTP ' + resp.status);
        const j = await resp.json();
        if (!j.success) throw new Error(j.warnings?.[0] || 'style-mirror fail');
        return j.data;
    }

    async function buildFromMessages({ contactKey, displayName, messages }) {
        if (!flagOn()) return { ok: false, reason: 'flag-off' };
        return call('profile', { contactKey, displayName, messages });
    }

    async function redact({ contactKey, intent, context = '' }) {
        if (!flagOn()) return { text: intent, fallback: true, reason: 'flag-off' };
        try { return await call('redact', { contactKey, intent, context }); }
        catch (e) { return { text: intent, fallback: true, error: e.message }; }
    }

    async function list() {
        try { return await call('list'); }
        catch { return []; }
    }

    async function get(contactKey) {
        try { return await call('get', { contactKey }); }
        catch { return null; }
    }

    async function remove(contactKey) {
        try { return await call('remove', { contactKey }); }
        catch { return { ok: false }; }
    }

    /**
     * Helper: construye perfil desde el log de WhatsApp del contacto (mensajes outbound del usuario).
     */
    async function buildFromWhatsApp(contactKey, displayName = '') {
        if (!window.GunterWhatsApp?.getMessagesByContact) {
            return { ok: false, reason: 'whatsapp-service-unavailable' };
        }
        try {
            const msgs = await window.GunterWhatsApp.getMessagesByContact(contactKey);
            const outbound = (msgs || [])
                .filter(m => m.direction === 'out' && m.text)
                .map(m => m.text)
                .slice(-50);
            if (outbound.length < 3) {
                return { ok: false, reason: 'not-enough-outbound', need: 3, have: outbound.length };
            }
            return await buildFromMessages({ contactKey, displayName: displayName || contactKey, messages: outbound });
        } catch (e) {
            return { ok: false, reason: e.message };
        }
    }

    window.GunterStyleMirror = {
        buildFromMessages, redact, list, get, remove,
        buildFromWhatsApp, flagOn
    };
})();
