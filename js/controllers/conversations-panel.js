/* Unified read/review/reply inbox. Suggestions never send automatically. */
(function () {
    let mount = null;
    let data = { items: [], stats: {} };
    let connections = [];
    let selectedId = null;
    let liveTimer = null;

    async function mountPanel(selector) {
        mount = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!mount) return;
        mount.innerHTML = skeleton();
        await refresh();
        if (!liveTimer) liveTimer = window.setInterval(() => {
            const draft = mount?.querySelector('#conv-message-input')?.value?.trim();
            if (!document.hidden && !draft && connections.some(item => item.connected)) refresh();
        }, 6000);
    }
    async function refresh() {
        try {
            const cp = window.GunterControlPlane;
            [data, connections] = await Promise.all([cp.conversations({ limit: 120 }), cp.socialConnections().then(value => value.items || [])]);
            if (!data.items.some(item => item.id === selectedId)) selectedId = data.items[0]?.id || null;
            render();
            window.dispatchEvent(new CustomEvent('gunter-conversations-updated', { detail: data.stats }));
        } catch (error) { renderError(error); }
    }
    function render() {
        const selected = data.items.find(item => item.id === selectedId);
        mount.innerHTML = `
            <section class="conv-hub" aria-label="Conversaciones conectadas">
                <header class="conv-hub__header">
                    <div><span class="conv-hub__eyebrow">CENTRO DE COMUNICACIONES</span><h2>Conversaciones</h2><p>Lee, entiende y prepara respuestas. Gunter nunca envía sin tu orden.</p></div>
                    <div class="conv-hub__header-actions"><span class="conv-hub__metric">${data.stats.unread || 0} por revisar</span><button type="button" class="gday__btn" data-conv-refresh>Actualizar</button><a class="gday__btn" href="config.html#data">Conexiones</a></div>
                </header>
                <div class="conv-hub__providers">${connections.map(connectionChip).join('')}</div>
                <div class="conv-hub__grid">
                    <aside class="conv-list" aria-label="Lista de conversaciones">
                        <label class="conv-search"><span>Buscar</span><input type="search" placeholder="Persona o mensaje" data-conv-search></label>
                        <div class="conv-list__items" data-conv-list>${renderThreads(data.items)}</div>
                    </aside>
                    <main class="conv-thread" data-conv-thread>${selected ? renderThread(selected) : emptyState()}</main>
                </div>
            </section>`;
        bind();
        if (selected) loadInsight(selected.id);
    }
    function renderThreads(items) {
        if (!items.length) return '<div class="conv-empty conv-empty--compact"><strong>Aún no hay mensajes</strong><span>Activa un canal en Configuración y las conversaciones aparecerán aquí.</span></div>';
        return items.map(thread => `<button type="button" class="conv-list__item ${thread.id === selectedId ? 'is-active' : ''}" data-thread-id="${escAttr(thread.id)}"><span class="conv-avatar" data-provider="${thread.provider}">${initial(thread.peerName)}</span><span class="conv-list__copy"><strong>${esc(thread.peerName)}</strong><small>${esc(thread.snippet)}</small></span><span class="conv-list__meta"><small>${relative(thread.updatedAt)}</small>${thread.unread ? `<b>${thread.unread}</b>` : ''}</span></button>`).join('');
    }
    function renderThread(thread) {
        const connection = connections.find(item => item.id === thread.provider);
        const canAttach = ['instagram', 'messenger'].includes(thread.provider);
        return `<header class="conv-thread__header"><div class="conv-avatar" data-provider="${thread.provider}">${initial(thread.peerName)}</div><div><strong>${esc(thread.peerName)}</strong><span>${providerLabel(thread.provider)} · ${connection?.connected ? 'conectado' : 'sin conexión activa'}</span></div></header>
            <section class="conv-insight" data-conv-insight><span class="conv-insight__orb">G</span><div><strong>Lectura de Gunter</strong><p>Analizando el contexto reciente…</p></div></section>
            <div class="conv-messages">${thread.messages.map(message => `<article class="conv-message ${message.direction === 'out' ? 'is-out' : 'is-in'}"><p>${esc(message.text)}</p><time>${formatTime(message.timestamp)}</time></article>`).join('')}</div>
            <form class="conv-composer" data-conv-form><label for="conv-message-input">Responder manualmente</label><textarea id="conv-message-input" rows="2" maxlength="4000" placeholder="Escribe tu mensaje…" ${connection?.connected ? '' : 'disabled'}></textarea><button type="submit" ${connection?.connected ? '' : 'disabled'}>Revisar y enviar</button>${canAttach ? `<label class="conv-attachment"><span>Adjunto opcional desde este PC</span><input type="text" data-conv-attachment maxlength="4096" placeholder="C:\\Users\\…\\archivo.pdf" ${connection?.connected ? '' : 'disabled'}><small>Usa una ruta absoluta permitida en Gunter Node. Máximo 100 MB.</small></label>` : ''}<small>${connection?.connected ? 'Se pedirá confirmación antes de enviar. Los adjuntos requieren Gunter Node y Beeper Desktop activos.' : `Conecta ${providerLabel(thread.provider)} en Configuración para responder.`}</small></form>`;
    }
    async function loadInsight(threadId) {
        const host = mount.querySelector('[data-conv-insight]');
        if (!host) return;
        try {
            const result = await window.GunterControlPlane.conversationInsight(threadId);
            const insight = result.insight;
            if (threadId !== selectedId) return;
            host.innerHTML = `<span class="conv-insight__orb">G</span><div><strong>Lectura de Gunter</strong><p>${esc(insight.summary)}</p><div class="conv-suggestions">${insight.suggestions.map((item, index) => `<button type="button" data-suggestion="${index}">${esc(item)}</button>`).join('')}</div></div>`;
            host.querySelectorAll('[data-suggestion]').forEach((button, index) => button.onclick = () => { const input = mount.querySelector('#conv-message-input'); if (input) { input.value = insight.suggestions[index]; input.focus(); } });
        } catch { host.querySelector('p').textContent = 'No pude generar una lectura en este momento.'; }
    }
    function bind() {
        mount.querySelector('[data-conv-refresh]')?.addEventListener('click', refresh);
        mount.querySelectorAll('[data-thread-id]').forEach(button => button.addEventListener('click', () => { selectedId = button.dataset.threadId; render(); }));
        mount.querySelector('[data-conv-search]')?.addEventListener('input', event => {
            const query = event.target.value.trim().toLowerCase();
            const filtered = data.items.filter(item => `${item.peerName} ${item.snippet}`.toLowerCase().includes(query));
            mount.querySelector('[data-conv-list]').innerHTML = renderThreads(filtered);
            mount.querySelectorAll('[data-thread-id]').forEach(button => button.addEventListener('click', () => { selectedId = button.dataset.threadId; render(); }));
        });
        mount.querySelector('[data-conv-form]')?.addEventListener('submit', send);
    }
    async function send(event) {
        event.preventDefault();
        const thread = data.items.find(item => item.id === selectedId);
        const input = event.currentTarget.querySelector('textarea');
        const text = input.value.trim();
        const attachmentPath = event.currentTarget.querySelector('[data-conv-attachment]')?.value?.trim() || '';
        if (!thread || (!text && !attachmentPath)) return;
        const attachmentCopy = attachmentPath ? `\n\nAdjunto del PC: ${attachmentPath.split(/[\\/]/).pop()}` : '';
        if (!window.confirm(`Enviar a ${thread.peerName} por ${providerLabel(thread.provider)}:\n\n${text || '(sin texto)'}${attachmentCopy}`)) return;
        const button = event.currentTarget.querySelector('button'); button.disabled = true; button.textContent = 'Enviando…';
        try {
            await window.GunterControlPlane.sendConversationMessage({ provider: thread.provider, peerId: thread.peerId, peerName: thread.peerName, text, attachmentPath, confirmed: true, source: 'user_click' });
            input.value = ''; const attachment = event.currentTarget.querySelector('[data-conv-attachment]'); if (attachment) attachment.value = ''; await refresh();
        } catch (error) { window.alert(humanError(error)); button.disabled = false; button.textContent = 'Revisar y enviar'; }
    }
    function connectionChip(item) { return `<span class="conv-provider ${item.connected ? 'is-connected' : ''}"><i></i>${esc(item.label)}<small>${stateLabel(item.state)}</small></span>`; }
    function emptyState() { return '<div class="conv-empty"><span class="conv-empty__mark">⌁</span><strong>Tu bandeja unificada empieza aquí</strong><p>Conecta WhatsApp o vincula tus cuentas personales de Instagram y Messenger. Gunter te explicará los requisitos antes de pedir acceso.</p><a href="config.html#data">Configurar canales</a></div>'; }
    function skeleton() { return '<div class="conv-hub conv-hub--loading"><div></div><div></div></div>'; }
    function renderError(error) { mount.innerHTML = `<div class="conv-empty"><strong>No pude cargar Conversaciones</strong><p>${esc(humanError(error))}</p><button class="gday__btn" type="button">Reintentar</button></div>`; mount.querySelector('button').onclick = refresh; }
    function humanError(error) { const map = { social_provider_disabled: 'Este canal está desactivado.', social_configuration_required: 'Falta configurar el proveedor.', social_adapter_required: 'El adaptador del proveedor aún no está instalado.', explicit_send_confirmation_required: 'El envío necesita confirmación explícita.', social_attachment_provider_unsupported: 'Este canal todavía no admite adjuntos desde Gunter.', beeper_attachment_requires_node: 'Para adjuntar archivos deben estar activos Gunter Node y Beeper Desktop en el PC que contiene el archivo.', desktop_absolute_path_required: 'Escribe la ruta absoluta del archivo.', desktop_path_not_allowed: 'La carpeta no está permitida en Gunter Node.', desktop_file_not_found: 'No encontré ese archivo en el PC.', beeper_attachment_too_large: 'El archivo supera el límite de 100 MB.', beeper_node_required: 'Vincula Gunter con Beeper Desktop desde Configuración.', beeper_node_offline: 'Beeper Desktop debe permanecer abierto para enviar y recibir.', beeper_token_invalid: 'El acceso de Gunter a Beeper fue revocado.', beeper_account_required: 'Añade esta cuenta dentro de Beeper y vuelve a verificarla.', beeper_reconnect_required: 'La cuenta necesita que vuelvas a identificarte en Beeper.', beeper_attention_required: 'Beeper necesita una verificación antes de continuar.' }; return map[error.code] || error.message || 'Ocurrió un error.'; }
    function providerLabel(id) { return ({ whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' })[id] || id; }
    function stateLabel(state) { return ({ connected: 'En vivo', syncing: 'Sincronizando', disabled: 'Desactivado', disconnected: 'Desconectado', node_required: 'Falta vincular', node_offline: 'Nodo apagado', token_invalid: 'Acceso revocado', account_required: 'Falta la cuenta', reconnect_required: 'Reconectar', attention_required: 'Requiere atención', connecting: 'Conectando', backfilling: 'Sincronizando' })[state] || state; }
    function formatTime(value) { try { return new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return ''; } }
    function relative(value) { const delta = Date.now() - new Date(value).getTime(); if (delta < 86400000) return formatTime(value); return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' }).format(new Date(value)); }
    function initial(value) { return esc(String(value || '?').trim().slice(0, 1).toUpperCase()); }
    function esc(value) { const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML; }
    function escAttr(value) { return esc(value).replace(/"/g, '&quot;'); }
    window.GunterConversationsPanel = { mount: mountPanel, refresh };
})();
