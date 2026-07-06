/* =============================================
   GUNTER — Smooth Scroll (Adventure Time cartoon feel)
   -------------------------------------------------
   Añade smooth scrolling con easing cartoon a la app.
   Solo intercepta clicks en links con href="#..." o
   [data-scroll-to]. Respeta prefers-reduced-motion.
   ============================================= */
(function () {
    if (window.GunterSmoothScroll) return;

    const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // Cartoon easing (overshoot ligero, tipo Adventure Time)
    function easeOutBack(t) {
        const c1 = 1.4;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function scrollTo(target, duration = 700) {
        if (REDUCED) {
            target.scrollIntoView({ behavior: 'auto', block: 'start' });
            return;
        }
        const startY = window.scrollY;
        const rect = target.getBoundingClientRect();
        const targetY = startY + rect.top - 20;
        const distance = targetY - startY;
        const startTime = performance.now();

        function frame(now) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = easeOutCubic(progress);
            window.scrollTo(0, startY + distance * eased);
            if (progress < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    // Intercepta clicks en links de anchor
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href^="#"], [data-scroll-to]');
        if (!link) return;
        const targetSel = link.getAttribute('href') || ('#' + link.dataset.scrollTo);
        if (!targetSel || targetSel === '#') return;
        const target = document.querySelector(targetSel);
        if (!target) return;
        e.preventDefault();
        scrollTo(target, 700);
    });

    // Sutil parallax en el fondo mientras scrolleas (efecto AT dreamy)
    let parallaxTicking = false;
    window.addEventListener('scroll', () => {
        if (REDUCED) return;
        if (parallaxTicking) return;
        parallaxTicking = true;
        requestAnimationFrame(() => {
            const scrolled = window.scrollY * 0.15;
            document.documentElement.style.setProperty('--gd-scroll-offset', scrolled + 'px');
            parallaxTicking = false;
        });
    }, { passive: true });

    window.GunterSmoothScroll = { scrollTo };
})();
