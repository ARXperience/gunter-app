/* =============================================
   GUNTER — Theme Toggle (light ↔ dark) v1
   -------------------------------------------------
   Auto-monta un botón flotante top-right que alterna
   entre body.at-light y body.at-dark.
   Persiste la preferencia en localStorage.
   ============================================= */
(function () {
    if (window.GunterThemeToggle) return;
    const KEY = 'gunter_theme';

    function getPreferred() {
        try {
            const saved = localStorage.getItem(KEY);
            if (saved === 'dark' || saved === 'light') return saved;
        } catch {}
        // Sistema
        if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
        return 'light';
    }

    function apply(mode) {
        document.body.classList.remove('at-light', 'at-dark');
        document.body.classList.add('at-' + mode);
        try { localStorage.setItem(KEY, mode); } catch {}
        const btn = document.querySelector('.gd-theme-toggle');
        if (btn) btn.innerHTML = mode === 'dark' ? sunSvg() : moonSvg();
    }

    function sunSvg() {
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>`;
    }
    function moonSvg() {
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>`;
    }

    function mount() {
        if (document.querySelector('.gd-theme-toggle')) return;
        const current = getPreferred();
        apply(current);

        const btn = document.createElement('button');
        btn.className = 'gd-theme-toggle';
        btn.setAttribute('aria-label', 'Cambiar tema claro/oscuro');
        btn.title = 'Cambiar tema';
        btn.innerHTML = current === 'dark' ? sunSvg() : moonSvg();
        btn.addEventListener('click', () => {
            const now = document.body.classList.contains('at-dark') ? 'light' : 'dark';
            apply(now);
        });
        document.body.appendChild(btn);
    }

    if (typeof window !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', mount);
        } else {
            mount();
        }
    }

    window.GunterThemeToggle = { apply, getPreferred, mount };
})();
