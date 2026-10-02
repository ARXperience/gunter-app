/* Gunter UI icons: one outline language for navigation, controls and settings. */
(function () {
    'use strict';
    if (window.GunterIconSystem) return;

    const PATHS = {
        home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
        message: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
        organize: '<path d="M4 5h16M7 12h10m-7 7h4"/><circle cx="6" cy="5" r="1"/><circle cx="18" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>',
        capture: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>',
        task: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="m8 11 2 2 5-5M8 17h8M9 2v4m6-4v4"/>',
        reminder: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M5 3 3 5m16-2 2 2"/>',
        activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
        chart: '<path d="M4 19V5m0 14h17M8 15l4-4 3 2 6-7"/>',
        link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2A5 5 0 0 0 12 3.9l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 1.9z" transform="translate(-1 -1)"/>',
        menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        assistant: '<path d="M12 3a7 7 0 0 0-7 7v3a7 7 0 0 0 14 0v-3a7 7 0 0 0-7-7Z"/><path d="M8.5 11h.01M15.5 11h.01M9 15c1.8 1.4 4.2 1.4 6 0M5 13H3m18 0h-2"/>',
        file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
        brain: '<path d="M12 18V5a3 3 0 0 0-5.8-1A4 4 0 0 0 4 11a4 4 0 0 0 2 7h6ZM12 18V5a3 3 0 0 1 5.8-1A4 4 0 0 1 20 11a4 4 0 0 1-2 7h-6Z"/><path d="M8 8a2 2 0 0 0 0 4m8-5a2 2 0 0 1 0 4"/>',
        bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
        trash: '<path d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6"/>',
        building: '<path d="M3 21h18M5 21V5l7-3 7 3v16M9 9h1m4 0h1M9 13h1m4 0h1m-6 8v-4h4v4"/>',
        palette: '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.7-3.1 1 1 0 0 1 .8-1.5H18a3 3 0 0 0 3-3A10 10 0 0 0 12 3Z"/><path d="M7.5 10h.01M10 7.5h.01m5 0h.01m2.5 3h.01"/>',
        microphone: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/>',
        music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
        warning: '<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01"/>',
        check: '<path d="m5 12 4 4L19 6"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
        cloud: '<path d="M20 16.2A4.5 4.5 0 0 0 18 7.5a6 6 0 0 0-11.5 1.7A4 4 0 0 0 7 17h12"/>',
        phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
        shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
        folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
        sparkle: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3ZM19 14l1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2L19 14Z"/>',
        globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18m0-18a15 15 0 0 0 0 18"/>',
        arrows: '<path d="M7 7h14l-4-4m4 4-4 4M17 17H3l4 4m-4-4 4-4"/>',
        lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 5v2"/>',
        help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1.1 1-1.7 1.4-1.7 3.2m0 3h.01"/>',
        penguin: '<ellipse cx="12" cy="13" rx="7" ry="9"/><path d="M8 11h.01M16 11h.01m-6.5 3.5h5L12 17zM8 21l-1 1m9-1 1 1"/>'
        ,clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
        ,pause: '<path d="M8 5v14m8-14v14"/>'
        ,play: '<path d="m8 5 12 7-12 7z"/>'
        ,edit: '<path d="m15 5 4 4M4 20l4-.8L19.2 8a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z"/>'
        ,close: '<path d="m6 6 12 12M18 6 6 18"/>'
        ,upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/>'
        ,download: '<path d="M12 4v12m-5-5 5 5 5-5M4 20h16"/>'
        ,save: '<path d="M5 3h12l4 4v14H3V3h2Zm1 0v6h10V3M7 21v-8h10v8"/>'
        ,headphones: '<path d="M3 14v-3a9 9 0 0 1 18 0v3m-18 0v4h4v-7H3m18 3v4h-4v-7h4"/>'
        ,users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6-7a4 4 0 0 1 0 8m2 4a4 4 0 0 1 2 3v2"/>'
        ,user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
        ,pin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>'
        ,book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22V5.5Zm0 0V22"/>'
        ,credit: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-14 5h4"/>'
        ,video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>'
        ,camera: '<path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v10H2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="3.5"/>'
        ,volume: '<path d="M4 10v4h4l5 4V6l-5 4H4Zm12-2a6 6 0 0 1 0 8m2-11a10 10 0 0 1 0 14"/>'
        ,box: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8m-9 5v9"/>'
        ,briefcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12h18m-11 0v2h4v-2"/>'
        ,cup: '<path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm13 2h2a2 2 0 0 1 0 4h-2M8 3v2m5-2v2"/>'
        ,flag: '<path d="M5 21V5m0 0c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>'
    };
    const GLYPHS = new Map([
        ['📋', 'task'], ['📅', 'calendar'], ['⏰', 'reminder'], ['💬', 'message'], ['📝', 'file'],
        ['🧠', 'brain'], ['🐧', 'penguin'], ['⚠', 'warning'], ['🏢', 'building'], ['🎨', 'palette'],
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

    function markup(name) {
        return `<svg class="gunter-icon" data-gunter-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || PATHS.sparkle}</svg>`;
    }

    function inferredIcon(target, glyph) {
        const mapped = GLYPHS.get(glyph.replace(/[\uFE0E\uFE0F\u200D]/g, '')) || GLYPHS.get(Array.from(glyph)[0]);
        if (mapped) return mapped;
        const label = `${target.getAttribute('aria-label') || ''} ${target.getAttribute('title') || ''} ${target.textContent || ''}`.toLocaleLowerCase('es');
        if (/ajuste|config|preferen/.test(label)) return 'settings';
        if (/mensaj|convers|chat/.test(label)) return 'message';
        if (/reun|agenda|calend/.test(label)) return 'calendar';
        if (/tarea|prior/.test(label)) return 'task';
        if (/record|alarma/.test(label)) return 'reminder';
        if (/archivo|document|transcrip/.test(label)) return 'file';
        if (/conex|vincul|cuenta/.test(label)) return 'link';
        if (/papelera|elimin/.test(label)) return 'trash';
        if (/alert|riesgo|error/.test(label)) return 'warning';
        return 'sparkle';
    }

    function normalizeTextIcons(target) {
        if (!target.matches(SAFE_TARGETS) || target.closest('[data-gunter-icon], .emoji-preserve')) return;
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        for (const node of textNodes) {
            if (!/\p{Extended_Pictographic}/u.test(node.nodeValue || '')) continue;
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
        if (root.matches?.('svg') && !root.matches('[data-preserve-icon]')) root.classList.add('gunter-icon-inline');
        root.querySelectorAll?.('button svg, a svg, summary svg, [role="tab"] svg, [class*="__icon"] svg, [class*="-icon"] svg')
            .forEach(svg => { if (!svg.hasAttribute('data-preserve-icon')) svg.classList.add('gunter-icon-inline'); });
    }

    function scan(root = document) {
        const targets = [];
        if (root.matches?.(SAFE_TARGETS)) targets.push(root);
        root.querySelectorAll?.(SAFE_TARGETS).forEach(target => targets.push(target));
        targets.forEach(normalizeTextIcons);
        normalizeSvgIcons(root);
    }

    function init() {
        scan();
        const observer = new MutationObserver(records => {
            records.forEach(record => record.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) scan(node);
            }));
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    window.GunterIconSystem = { init, markup, paths: Object.keys(PATHS) };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
