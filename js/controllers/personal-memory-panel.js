/* Explicit personal-memory manager in Configuración → Datos. */
(function (root) {
    if (root.GunterPersonalMemoryPanel) return;
    let editingId = null;
    let searchTimer = null;

    function status(message, error = false) {
        const target = document.getElementById('personal-memory-status');
        if (!target) return;
        target.textContent = message;
        target.style.color = error ? 'var(--error, #fca5a5)' : 'var(--text-secondary)';
    }
    function resetForm() {
        editingId = null;
        document.getElementById('personal-memory-form')?.reset();
        document.getElementById('personal-memory-save').textContent = 'Guardar recuerdo';
        document.getElementById('personal-memory-cancel').hidden = true;
    }
    function item(record) {
        const article = document.createElement('article');
        article.className = 'personal-memory-item';
        const label = document.createElement('small');
        label.textContent = record.type === 'preference' ? 'Preferencia' : 'Dato personal';
        const content = document.createElement('p');
        content.textContent = record.content;
        const actions = document.createElement('div');
        actions.className = 'personal-memory-item-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn btn--secondary';
        edit.textContent = 'Editar';
        edit.addEventListener('click', () => {
            editingId = record.id;
            document.getElementById('personal-memory-type').value = record.type;
            document.getElementById('personal-memory-content').value = record.content;
            document.getElementById('personal-memory-save').textContent = 'Guardar cambios';
            document.getElementById('personal-memory-cancel').hidden = false;
            document.getElementById('personal-memory-content').focus();
            status('Editando un recuerdo.');
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn--danger';
        remove.textContent = 'Eliminar';
        remove.addEventListener('click', async () => {
            if (!root.confirm('¿Eliminar este recuerdo de Gunter?')) return;
            try {
                const deleted = await root.GunterPersonalMemory.remove(record.id);
                if (editingId === record.id) resetForm();
                status(deleted ? 'Recuerdo eliminado.' : 'Ese recuerdo ya no estaba disponible.');
                await render();
            } catch { status('No pude comprobar que se eliminara. Prueba de nuevo.', true); }
        });
        actions.append(edit, remove);
        article.append(label, content, actions);
        return article;
    }
    async function render() {
        const list = document.getElementById('personal-memory-list');
        if (!list) return;
        list.replaceChildren();
        try {
            const query = document.getElementById('personal-memory-search')?.value || '';
            const records = await root.GunterPersonalMemory.search(query);
            if (!records.length) {
                const empty = document.createElement('p');
                empty.className = 'settings-card__hint';
                empty.textContent = query ? 'No encontré recuerdos con ese texto.' : 'Todavía no has guardado datos personales ni preferencias.';
                list.appendChild(empty);
                return;
            }
            records.forEach(record => list.appendChild(item(record)));
        } catch (error) {
            status(error?.message === 'MEMORY_AUTH_REQUIRED'
                ? 'Inicia sesión para acceder a la memoria de este dispositivo.'
                : 'No pude cargar la memoria local. Recarga esta página o revisa el almacenamiento del navegador.', true);
        }
    }
    async function submit(event) {
        event.preventDefault();
        const saveButton = document.getElementById('personal-memory-save');
        saveButton.disabled = true;
        try {
            const type = document.getElementById('personal-memory-type').value;
            const content = document.getElementById('personal-memory-content').value;
            const result = await root.GunterPersonalMemory.save({ id: editingId, type, content });
            status(result.duplicate ? 'Ese recuerdo ya existe; no creé una copia.' :
                editingId ? 'Recuerdo actualizado.' : 'Recuerdo guardado en este dispositivo.');
            resetForm();
            await render();
        } catch (error) {
            status(error instanceof TypeError ? 'Escribe entre 4 y 2000 caracteres.' :
                'No pude verificar el guardado. Revisa la sesión y el almacenamiento local.', true);
        } finally { saveButton.disabled = false; }
    }
    function bind() {
        if (!document.getElementById('personal-memory-card')) return;
        document.getElementById('personal-memory-form').addEventListener('submit', submit);
        document.getElementById('personal-memory-cancel').addEventListener('click', () => { resetForm(); status('Edición cancelada.'); });
        document.getElementById('personal-memory-search').addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(render, 150);
        });
        document.addEventListener('gunter-auth-ready', render);
        render();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
    root.GunterPersonalMemoryPanel = Object.freeze({ render });
})(typeof window !== 'undefined' ? window : globalThis);
