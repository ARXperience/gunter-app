/* Color mode is resolved before CSS/body paint; meeting themes are independent. */
(function () {
    'use strict';
    if (window.GunterThemeBootstrap) return;
    const KEY = 'gunter_color_mode';
    const root = document.documentElement;
    const system = window.matchMedia?.('(prefers-color-scheme: dark)');
    let current = null;
    let explicit = null;
    let bodyObserver = null;

    function storedMode() {
        try {
            const saved = localStorage.getItem(KEY);
            if (saved === 'dark' || saved === 'light') return saved;
            const legacy = localStorage.getItem('gunter_theme');
            if (legacy === 'dark' || legacy === 'light') return legacy;
            const flag = localStorage.getItem('gunter_dark_mode');
            if (flag === 'true' || flag === 'false') return flag === 'true' ? 'dark' : 'light';
        } catch { /* Restricted storage still allows the device preference. */ }
        return null;
    }

    function hasExplicitPreference() { return explicit !== null; }
    function getPreferred() { return current || explicit || (system?.matches ? 'dark' : 'light'); }

    function classes(node, mode) {
        if (!node?.classList) return;
        node.classList.toggle('at-dark', mode === 'dark');
        node.classList.toggle('at-light', mode === 'light');
    }

    function syncBody() {
        if (!document.body) return false;
        classes(document.body, current);
        bodyObserver?.disconnect();
        bodyObserver = null;
        return true;
    }

    function apply(mode, persist = true) {
        if (mode !== 'dark' && mode !== 'light') return current;
        const previousMode = current;
        current = mode;
        if (persist) {
            explicit = mode;
            try {
                if (localStorage.getItem(KEY) !== mode) localStorage.setItem(KEY, mode);
                const flag = String(mode === 'dark');
                if (localStorage.getItem('gunter_dark_mode') !== flag) localStorage.setItem('gunter_dark_mode', flag);
            } catch { /* Apply in this document even when persistence is unavailable. */ }
        }
        root.setAttribute('data-color-mode', mode);
        classes(root, mode);
        root.style.colorScheme = mode;
        // The document canvas must match the workspace while styles are loading.
        root.style.backgroundColor = mode === 'light' ? '#dce8f7' : '#080d20';
        syncBody();
        const preference = document.getElementById('pref-dark-mode');
        if (preference) preference.checked = mode === 'dark';
        if (previousMode !== mode) {
            window.dispatchEvent(new CustomEvent('gunter-theme-changed', { detail: { mode, previousMode } }));
        }
        return mode;
    }

    function sync() { return apply(explicit || (system?.matches ? 'dark' : 'light'), false); }
    window.GunterThemeBootstrap = { apply, getPreferred, hasExplicitPreference, sync };
    explicit = storedMode();
    sync();
    if (!document.body && typeof MutationObserver !== 'undefined') {
        // Parser-created body.at-dark is corrected in the mutation checkpoint,
        // before the browser renders it. No content is hidden or globally repainted.
        bodyObserver = new MutationObserver(syncBody);
        bodyObserver.observe(root, { childList: true, subtree: true });
    }
    document.addEventListener('DOMContentLoaded', syncBody, { once: true });
    system?.addEventListener?.('change', () => { if (!hasExplicitPreference()) sync(); });
    window.addEventListener('storage', event => {
        if (event.key === null || [KEY, 'gunter_theme', 'gunter_dark_mode'].includes(event.key)) {
            explicit = storedMode();
            sync();
        }
    });
    window.addEventListener('pageshow', event => {
        if (event.persisted) { explicit = storedMode(); sync(); }
        else syncBody();
    });
})();
