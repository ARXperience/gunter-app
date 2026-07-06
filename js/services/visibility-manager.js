/* =============================================
   GUNTER — Visibility Manager (v1)
   -------------------------------------------------
   Pausa timers / observers cuando la app está en background.
   Ahorra batería en Android.

   Registro de callbacks:
     GunterVisibility.onHide(fn)   → cuando la app se oculta
     GunterVisibility.onShow(fn)   → cuando vuelve al primer plano
     GunterVisibility.isHidden()   → estado actual
   ============================================= */

(function () {
    if (window.GunterVisibility) return;

    const HIDE_HANDLERS = [];
    const SHOW_HANDLERS = [];
    let hidden = document.hidden;

    function fire(list) {
        for (const fn of list) {
            try { fn(); } catch (e) { console.warn('[visibility] handler error:', e.message); }
        }
    }

    function handleChange() {
        const newHidden = document.hidden;
        if (newHidden === hidden) return;
        hidden = newHidden;
        if (hidden) {
            document.body.classList.add('app-hidden');
            fire(HIDE_HANDLERS);
        } else {
            document.body.classList.remove('app-hidden');
            fire(SHOW_HANDLERS);
        }
    }

    document.addEventListener('visibilitychange', handleChange);
    window.addEventListener('pagehide', () => {
        hidden = true;
        document.body.classList.add('app-hidden');
        fire(HIDE_HANDLERS);
    });
    window.addEventListener('pageshow', () => {
        hidden = false;
        document.body.classList.remove('app-hidden');
        fire(SHOW_HANDLERS);
    });

    window.GunterVisibility = {
        onHide(fn) { if (typeof fn === 'function') HIDE_HANDLERS.push(fn); },
        onShow(fn) { if (typeof fn === 'function') SHOW_HANDLERS.push(fn); },
        isHidden() { return hidden; }
    };
})();
