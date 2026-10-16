/* Gunter UI: one faceted, fine-line family and an eight-point energy signature. */
(function () {
    'use strict';
    if (window.GunterIconSystem) return;

    const REVISION = 'octa-1';
    const OCTAGRAM = '<path d="M12 2.5 21.5 12 12 21.5 2.5 12Z"/><path d="M5.3 5.3h13.4v13.4H5.3Z" opacity=".58"/><path d="M7.5 12c2.2-5.1 6.8-5.1 9 0-2.2 5.1-6.8 5.1-9 0Z"/><path d="M12 9v6m-3-3h6" opacity=".72"/>';
    const PATHS = {
        core: OCTAGRAM, assistant: OCTAGRAM, penguin: OCTAGRAM,
        home: '<path d="m3.5 10 8.5-7 8.5 7v10.5h-6v-6h-5v6h-6Z"/><path d="M9.5 7.8 12 5.7l2.5 2.1" opacity=".45"/>',
        message: '<path d="M5 3.5h14l2 2v11l-2 2h-8l-6 3v-3H3V5.5Z"/><path d="M7 8.5h10m-10 4h6"/>',
        calendar: '<path d="M5 5h14l2 2v12l-2 2H5l-2-2V7Z"/><path d="M7.5 2.5v5m9-5v5M3 10h18m-14 4h3m4 0h3m-10 3h3"/>',
        organize: '<path d="M3 6h18M3 12h18M3 18h18" opacity=".45"/><path d="M7 3v6m10 0v6M10 15v6"/>',
        capture: '<path d="M8 3H5L3 5v3m13-5h3l2 2v3M3 16v3l2 2h3m13-5v3l-2 2h-3M12 7v10m-5-5h10"/>',
        task: '<path d="M8 4H5L3.5 5.5v14L5 21h14l1.5-1.5v-14L19 4h-3M8 2.5h8v4H8Z"/><path d="m7 12 2 2 4-4m-6 7h10"/>',
        reminder: '<path d="M7 3 3.5 6.5M17 3l3.5 3.5M7 21l1-2m9 2-1-2"/><path d="M12 4.5 18 7l2.5 6-2.5 6H6l-2.5-6L6 7Z"/><path d="M12 8v5l3 1.5"/>',
        activity: '<path d="M2.5 12H7l3-7 4 14 3-7h4.5"/><path d="M3 5v2m18 10v2" opacity=".45"/>',
        chart: '<path d="M3.5 3v17.5H21M7 15l4-4 4 2 6-8"/><path d="M17 5h4v4"/>',
        link: '<path d="m9 15 6-6m-7 3-2 2a4 4 0 0 0 5.7 5.7l3-3m1.3-4.7 2-2a4 4 0 0 0-5.7-5.7l-3 3"/>',
        settings: '<path d="m9 2.5-1 3-3 1-2.5 5.5L5 17.5l3 1 1 3h6l1-3 3-1 2.5-5.5L19 6.5l-3-1-1-3Z"/><path d="m12 8-4 4 4 4 4-4Z"/>',
        menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/><path d="M4 6.5h3m10 11h3" stroke-width="2.4"/>',
        plus: '<path d="M12 4v16M4 12h16"/>',
        file: '<path d="M6 2.5h8l6 6v12l-1 1H5l-1-1v-16Z"/><path d="M14 2.5v6h6M8 13h8m-8 4h6"/>',
        brain: '<path d="M12 5 8 2.5 4 5v5l-2 3 3 6 4 2.5 3-3 3 3 4-2.5 3-6-2-3V5l-4-2.5Z"/><path d="M12 5v13.5M7 7l2 2-2 3 2 3m8-8-2 2 2 3-2 3"/>',
        bell: '<path d="M4 17.5 6 14V8l2-3h8l2 3v6l2 3.5H4ZM10 21h4m-2-19v3"/>',
        trash: '<path d="M3 6h18M5 6l1 14.5h12L19 6M8 6V3.5h8V6m-6 4v6m4-6v6"/>',
        building: '<path d="M3 21h18M5 21V5l7-3 7 3v16M9 8h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1m-5 5v-3h4v3"/>',
        palette: '<path d="M12 2.5 6 4 2.5 10 4 17l5 4.5h4l1.5-2-1-3H18l3.5-3.5L20 7l-4-3.5Z"/><path d="M7 10h.01M10 6.5h.01m5 0h.01m2.5 4h.01" stroke-width="2.5"/>',
        microphone: '<path d="M9 3h6l1 2v6l-1 2H9l-1-2V5Z"/><path d="M5 10v2l2 4 5 2 5-2 2-4v-2M12 18v3m-4 0h8"/>',
        music: '<path d="M9 18V5l12-2v13M9 8l12-2"/><path d="m6 15 3 1v4l-3 1-3-1v-4Zm12-2 3 1v4l-3 1-3-1v-4Z"/>',
        warning: '<path d="m12 3 10 17H2Z"/><path d="M12 9v5m0 3h.01"/>',
        check: '<path d="m4.5 12 5 5 10-11"/>',
        search: '<path d="m10.5 3 5.3 2.2L18 10.5l-2.2 5.3-5.3 2.2-5.3-2.2L3 10.5l2.2-5.3Z"/><path d="m16 16 5 5"/>',
        cloud: '<path d="M7 18H4l-2-3 1-4 4-1 2-6 6-1 5 4v4l2 2v3l-2 2h-3"/><path d="M12 12v9m-3-3 3 3 3-3"/>',
        phone: '<path d="M7 2.5h10L19 5v14l-2 2.5H7L5 19V5Z"/><path d="M10 5h4m-3 13.5h2"/>',
        shield: '<path d="M12 2.5 21 6v7l-3 5-6 4-6-4-3-5V6Z"/><path d="m8 12 3 3 5-6"/>',
        folder: '<path d="M3 4.5h7l2.5 3H20l1 1v11l-1 1H4l-1-1Z"/><path d="M3 10h18" opacity=".45"/>',
        sparkle: '<path d="m12 2.5 2.4 6.1 6.1 3.4-6.1 2.4-2.4 7.1-3.4-7.1L2.5 12l6.1-3.4Z"/><path d="M5 5l3 3m8 8 3 3M19 5l-3 3M5 19l3-3" opacity=".45"/>',
        globe: '<path d="m12 2.5 6.7 2.8 2.8 6.7-2.8 6.7-6.7 2.8-6.7-2.8L2.5 12l2.8-6.7Z"/><path d="M2.5 12h19M12 2.5l-4 6v7l4 6 4-6v-7Z"/>',
        arrows: '<path d="M3 7h18l-4-4m4 4-4 4M21 17H3l4-4m-4 4 4 4"/>',
        lock: '<path d="M6 10h12l2 2v7l-2 2H6l-2-2v-7ZM8 10V6l2-3h4l2 3v4m-4 4v3"/>',
        help: '<path d="m12 2.5 6.7 2.8 2.8 6.7-2.8 6.7-6.7 2.8-6.7-2.8L2.5 12l2.8-6.7Z"/><path d="M9 8.5 10 7h4l1 1.5v2l-3 2V14m0 3h.01"/>',
        clock: '<path d="m12 2.5 6.7 2.8 2.8 6.7-2.8 6.7-6.7 2.8-6.7-2.8L2.5 12l2.8-6.7Z"/><path d="M12 7v5l4 2"/>',
        pause: '<path d="M7 4h3v16H7Zm7 0h3v16h-3Z"/>',
        play: '<path d="M7 3.5 21 12 7 20.5Z"/>',
        edit: '<path d="m14 5 5 5M3.5 20.5 5 15 17 3l4 4L9 19Z"/>',
        close: '<path d="m5 5 14 14M19 5 5 19"/>',
        upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 16v4.5h18V16"/>',
        download: '<path d="M12 3v13m-5-5 5 5 5-5M3 16v4.5h18V16"/>',
        save: '<path d="M3.5 3.5H17l3.5 3.5v13.5h-17ZM7 3.5v6h9v-6M7 20.5V14h10v6.5"/>',
        headphones: '<path d="M3 14V9l3-5 6-2 6 2 3 5v9l-1 2h-4V11h5M3 11h5v9H4l-1-2"/>',
        users: '<path d="m9 3 4 2v5l-4 2-4-2V5ZM2.5 21v-4l3-2h7l3 2v4m1-18 4 2v5l-4 2m2 3 3.5 2v4"/>',
        user: '<path d="m12 2.5 4 2v5l-4 2-4-2v-5ZM4 21v-4l4-3h8l4 3v4"/>',
        pin: '<path d="M12 22 4 12V6l4-4h8l4 4v6Z"/><path d="m12 6 3 3-3 3-3-3Z"/>',
        book: '<path d="M4 4h7l1 2 1-2h7v16h-7l-1 2-1-2H4ZM12 6v16M7 8h2m6 0h2"/>',
        credit: '<path d="M5 4.5h14l2 2v11l-2 2H5l-2-2v-11ZM3 9h18M7 15h4m5 0h1"/>',
        video: '<path d="M4 5.5h10l2 2v9l-2 2H4l-2-2v-9ZM16 10l6-4v12l-6-4"/>',
        camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><path d="m12 9-4 4 4 4 4-4Z"/>',
        volume: '<path d="M3 9h4l6-5v16l-6-5H3ZM16 8l2 4-2 4m3-11 3 7-3 7"/>',
        box: '<path d="m12 2.5 9 5-9 5-9-5ZM3 7.5V17l9 5 9-5V7.5M12 12.5V22m-4.5-17 9 5"/>',
        briefcase: '<path d="M5 7h14l2 2v10l-2 2H5l-2-2V9ZM8 7V3.5h8V7M3 12h18m-11 0v3h4v-3"/>',
        cup: '<path d="M4 7.5h13V16l-3 4H7l-3-4ZM17 9h4v6h-4M8 2.5v2m5-2v2"/>',
        flag: '<path d="M5 22V3h6l2 2h7v10h-7l-2-2H5"/>',
        send: '<path d="m3 3 19 9L3 21l4-9Zm4 9h15"/>',
        refresh: '<path d="M20 9a8.5 8.5 0 0 0-14-4L3 8m0-5v5h5M4 15a8.5 8.5 0 0 0 14 4l3-3m0 5v-5h-5"/>',
        chevron: '<path d="m8 4 8 8-8 8"/>',
        arrow: '<path d="M3 12h18m-7-7 7 7-7 7"/>',
        back: '<path d="M21 12H3m7-7-7 7 7 7"/>',
        eye: '<path d="M2 12 7 6h10l5 6-5 6H7Z"/><path d="m12 8 4 4-4 4-4-4Z"/>',
        logout: '<path d="M10 3H4v18h6m4-14 5 5-5 5m-7-5h12"/>',
        filter: '<path d="M3 4h18l-7 8v7l-4 2v-9Z"/>',
        sun: '<path d="m12 7 5 5-5 5-5-5ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
        moon: '<path d="M20.5 14A9.5 9.5 0 0 1 10 3 9.5 9.5 0 1 0 20.5 14Z"/>'
    };
    const GLYPHS = new Map([
        ['📋', 'task'], ['📅', 'calendar'], ['⏰', 'reminder'], ['💬', 'message'], ['📝', 'file'],
        ['🧠', 'brain'], ['🐧', 'core'], ['⚠', 'warning'], ['🏢', 'building'], ['🎨', 'palette'],
        ['🎙', 'microphone'], ['🎵', 'music'], ['✨', 'sparkle'], ['✅', 'check'], ['🔔', 'bell'],
        ['🔒', 'lock'], ['📁', 'folder'], ['🔍', 'search'], ['🌐', 'globe'], ['📞', 'phone'],
        ['🛡', 'shield'], ['🗑', 'trash'], ['💡', 'sparkle'], ['🔗', 'link'], ['🎤', 'microphone'],
        ['📊', 'chart'], ['📈', 'chart'], ['📄', 'file'], ['📌', 'capture'], ['☯', 'arrows'],
        ['⚙', 'settings'], ['☰', 'menu'], ['➕', 'plus'], ['＋', 'plus'], ['⌛', 'clock'], ['⏱', 'clock'],
        ['⏳', 'clock'], ['⏸', 'pause'], ['▶', 'play'], ['★', 'sparkle'], ['⭐', 'sparkle'],
        ['🌟', 'sparkle'], ['☕', 'cup'], ['✂', 'edit'], ['✎', 'edit'], ['✏', 'edit'],
        ['✖', 'close'], ['❌', 'close'], ['❗', 'warning'], ['❓', 'help'], ['➡', 'link'],
        ['⬇', 'download'], ['⚡', 'activity'], ['👤', 'user'], ['👥', 'users'], ['👋', 'assistant'],
        ['👑', 'settings'], ['💭', 'message'], ['💾', 'save'], ['💼', 'briefcase'], ['💳', 'credit'],
        ['💰', 'credit'], ['💵', 'credit'], ['💸', 'credit'], ['📎', 'link'], ['📍', 'pin'],
        ['📌', 'pin'], ['📚', 'book'], ['📖', 'book'], ['📜', 'file'], ['📃', 'file'],
        ['📤', 'upload'], ['📥', 'download'], ['📦', 'box'], ['📱', 'phone'], ['📷', 'camera'],
        ['🎧', 'headphones'], ['🎬', 'video'], ['🎭', 'palette'], ['🎮', 'activity'], ['🎯', 'capture'],
        ['🏁', 'flag'], ['🏆', 'chart'], ['🏛', 'building'], ['🌅', 'activity'], ['🌍', 'globe'],
        ['🌡', 'activity'], ['🌱', 'sparkle'], ['🌿', 'sparkle'], ['🧹', 'trash'], ['🩹', 'shield'],
        ['🧬', 'brain'], ['🎉', 'sparkle'], ['🎓', 'book'], ['🎩', 'settings'], ['💎', 'sparkle'],
        ['💜', 'sparkle'], ['💫', 'sparkle'], ['💪', 'activity'], ['🧪', 'brain'], ['🛠', 'organize'],
        ['🔋', 'activity'], ['🔑', 'lock'], ['🪄', 'sparkle'], ['🧭', 'globe'], ['💻', 'phone'],
        ['🔄', 'arrows'], ['🔗', 'link'], ['🔊', 'volume'], ['📡', 'globe'], ['📢', 'volume']
    ]);
    const SAFE_TARGETS = 'button, a, summary, label, [role="tab"], h1, h2, h3, h4, h5, legend, .gday__chip > span:first-child, [class~="icon"], [class*="__icon"], [class*="-icon"], [class*="warning"], [class*="status"], [class*="badge"], [class*="tag"], [data-icon]';
    const CONTROL = 'button, a, summary, label, [role="tab"], [role="button"]';
    const PRESERVE = '[data-preserve-icon], .emoji-preserve, [data-chart], [data-diagram], .mermaid, .diagram, .chart, .plot, .gunter-idle-core, script, style, textarea, code, pre, [contenteditable="true"]';
    let initialized = false;

    function iconName(name) {
        return Object.hasOwn(PATHS, name) ? name : 'sparkle';
    }

    function markup(name) {
        const selected = iconName(name);
        return `<svg class="gunter-icon" data-gunter-icon="${selected}" data-gunter-icon-revision="${REVISION}:${selected}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[selected]}</svg>`;
    }

    // Unknown art and service logos stay intact; only verified control semantics are inferred.
    function semanticIcon(target) {
        const explicit = target?.getAttribute('data-icon') || target?.getAttribute('data-gunter-icon');
        if (explicit && Object.hasOwn(PATHS, explicit)) return explicit;
        const label = `${target?.getAttribute('aria-label') || ''} ${target?.getAttribute('title') || ''} ${target?.textContent || ''}`
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        if (label.length > 140) return null;
        const rules = [
            [/^(?:cerrar sesion|salir|logout)\b/, 'logout'],
            [/^(?:eliminar|borrar|vaciar|papelera|delete|remove|trash)\b/, 'trash'],
            [/^(?:cerrar|descartar|close|dismiss)\b/, 'close'],
            [/^(?:editar|renombrar|edit|rename)\b/, 'edit'],
            [/^(?:enviar|send)\b/, 'send'],
            [/^(?:guardar|save)\b/, 'save'],
            [/^(?:descargar|exportar|download|export)\b/, 'download'],
            [/^(?:subir|importar|upload|import)\b/, 'upload'],
            [/^(?:buscar|search)\b/, 'search'],
            [/^(?:reintentar|actualizar|recargar|retry|refresh|sincronizar)\b/, 'refresh'],
            [/^(?:pausar|pause)\b/, 'pause'],
            [/^(?:reproducir|play)\b/, 'play'],
            [/^(?:hablar|microfono|dictar|grabar|voz y escucha|voice input|microphone)\b/, 'microphone'],
            [/^(?:silenciar|volumen|audio|respuestas por voz|volume)\b/, 'volume'],
            [/^(?:crear|anadir|agregar|nuevo|nueva|add|new)\b/, 'plus'],
            [/^(?:abrir menu|menu|mas opciones|more options)\b/, 'menu'],
            [/^(?:mi cuenta|perfil|profile|account)\b/, 'user'],
            [/^(?:inicio|home)\b/, 'home'],
            [/^(?:conversaciones|mensajes|chat|conversations)\b/, 'message'],
            [/^(?:agenda|reuniones|calendario|calendar|meetings)\b/, 'calendar'],
            [/^(?:tareas|compromisos|tasks)\b/, 'task'],
            [/^(?:recordatorios|alarmas|reminders)\b/, 'reminder'],
            [/^(?:asistente|gunter|consultar a gunter)\b/, 'core'],
            [/^(?:resultados|informes|results|reports)\b/, 'chart'],
            [/^(?:actividad|diagnostico|activity|diagnostics)\b/, 'activity'],
            [/^(?:conexiones|dispositivos|connections|devices)\b/, 'link'],
            [/^(?:acciones y permisos|seguridad|security|permissions)\b/, 'shield'],
            [/^(?:datos y privacidad|privacidad|privacy)\b/, 'lock'],
            [/^(?:apariencia|appearance)\b/, 'palette'],
            [/^(?:configur|ajuste|preferencia|settings)/, 'settings'],
            [/^(?:ayuda|informacion|help|information)\b/, 'help'],
            [/^(?:volver|regresar|back)\b/, 'back'],
            [/^(?:tema oscuro|modo oscuro|dark mode)\b/, 'moon'],
            [/^(?:tema claro|modo claro|light mode)\b/, 'sun']
        ];
        return rules.find(([pattern]) => pattern.test(label))?.[1] || null;
    }

    function inferredIcon(target, glyph) {
        return GLYPHS.get(glyph.replace(/[\uFE0E\uFE0F\u200D]/g, '')) || GLYPHS.get(Array.from(glyph)[0]) || semanticIcon(target) || 'sparkle';
    }

    function applyIcon(svg, name) {
        if (svg.closest(PRESERVE)) return;
        const selected = iconName(name);
        // Guard every write; mutation callbacks must converge rather than retrigger forever.
        const stamp = `${REVISION}:${selected}`;
        if (svg.getAttribute('data-gunter-icon-revision') === stamp && svg.getAttribute('data-gunter-icon') === selected) return;
        svg.innerHTML = PATHS[selected];
        const attrs = {
            'data-gunter-icon': selected, 'data-gunter-icon-revision': stamp,
            viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.55',
            'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false'
        };
        Object.entries(attrs).forEach(([key, value]) => { if (svg.getAttribute(key) !== value) svg.setAttribute(key, value); });
        svg.classList.add('gunter-icon', 'gunter-icon-inline');
    }

    function normalizeTextIcons(target) {
        if (!target.matches(SAFE_TARGETS) || target.closest(PRESERVE) || target.closest('[data-gunter-icon]')) return;
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        for (const node of textNodes) {
            if (node.parentElement?.closest(`${PRESERVE}, svg`) || !/\p{Extended_Pictographic}/u.test(node.nodeValue || '')) continue;
            const source = node.nodeValue;
            const fragment = document.createDocumentFragment();
            const pictographs = /\p{Extended_Pictographic}[\uFE0E\uFE0F]?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?)*/gu;
            let cursor = 0;
            let found = false;
            for (const match of source.matchAll(pictographs)) {
                found = true;
                fragment.append(document.createTextNode(source.slice(cursor, match.index)));
                const glyph = match[0];
                fragment.append(document.createRange().createContextualFragment(markup(inferredIcon(target, glyph))));
                cursor = match.index + glyph.length;
            }
            if (!found) continue;
            fragment.append(document.createTextNode(source.slice(cursor)));
            node.replaceWith(fragment);
        }
    }

    function normalizeSvgIcons(root = document) {
        const candidates = [];
        if (root.matches?.('svg')) candidates.push(root);
        root.querySelectorAll?.('svg').forEach(svg => candidates.push(svg));
        candidates.forEach(svg => {
            if (svg.closest(PRESERVE)) return;
            const named = svg.getAttribute('data-gunter-icon');
            if (named) return applyIcon(svg, named);
            const control = svg.closest(CONTROL);
            const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
            // UI-sized symbols only: don't rewrite charts, large illustrations or custom graphs.
            if (!control || viewBox.length !== 4 || viewBox[0] !== 0 || viewBox[1] !== 0 || viewBox[2] > 36 || viewBox[3] > 36 || !viewBox[2] || !viewBox[3]) return;
            const name = semanticIcon(svg) || semanticIcon(control);
            if (name) applyIcon(svg, name);
            else svg.classList.add('gunter-icon-inline');
        });
    }

    function scan(root = document) {
        if (root.closest?.(PRESERVE)) return;
        const targets = [];
        if (root.matches?.(SAFE_TARGETS)) targets.push(root);
        root.querySelectorAll?.(SAFE_TARGETS).forEach(target => targets.push(target));
        targets.forEach(normalizeTextIcons);
        normalizeSvgIcons(root);
    }

    function init() {
        if (initialized) return;
        initialized = true;
        scan();
        const observer = new MutationObserver(records => {
            const roots = new Set();
            records.forEach(record => {
                if (record.type === 'attributes') roots.add(record.target);
                else record.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE && (node.matches?.('svg') || !node.closest?.('svg'))) roots.add(node);
                    else if (node.nodeType === Node.TEXT_NODE && node.parentElement && /\p{Extended_Pictographic}/u.test(node.nodeValue || '')) roots.add(node.parentElement);
                });
            });
            roots.forEach(scan);
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-gunter-icon'] });
    }

    window.GunterIconSystem = { init, markup, refresh: scan, semanticIcon, paths: Object.keys(PATHS), revision: REVISION };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
