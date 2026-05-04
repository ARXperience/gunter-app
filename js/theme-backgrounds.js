/* =============================================
   GUNTER APP - Click Burst Effects (Foreground)
   -------------------------------------------------
   Antes un fondo permanente; ahora NO hay animación
   de fondo — se genera un efecto SOLO al hacer click,
   en una capa por encima de todo (z-index alto,
   pointer-events: none). Cada modo pinta distinto:

     empresarial → ripple cian + cuadrados que vuelan
     artistico   → explosión policromática orgánica
     podcast     → anillos sónicos + burbujas cálidas
     zen         → ripple dorado sereno + pétalos

   El canvas solo corre cuando hay efectos en curso;
   se auto-destruye al acabar → CPU en reposo ≈ 0 %.
   ============================================= */

(function () {
    const MODE_PALETTES = {
        empresarial: { type: 'grid',   primary: '#00d4ff', secondary: '#4a9eff', tertiary: '#ffffff' },
        artistico:   { type: 'blobs',  primary: '#ff006e', secondary: '#8b5cf6', tertiary: '#ec4899' },
        podcast:     { type: 'waves',  primary: '#ffaa00', secondary: '#a855f7', tertiary: '#fbbf24' },
        zen:         { type: 'petals', primary: '#e8c87a', secondary: '#9ec4a4', tertiary: '#ffffff' }
    };

    let canvas = null, ctx = null, rafId = null;
    let w = 0, h = 0, dpr = 1;
    let effects = [];   // active burst effects
    let currentMode = 'empresarial';
    let respectReduceMotion = false;

    function ensureCanvas() {
        if (canvas) return;
        respectReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        canvas = document.createElement('canvas');
        canvas.id = 'gunter-click-fx';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = `
            position: fixed; inset: 0;
            z-index: 9998;
            pointer-events: none;
        `;
        document.body.appendChild(canvas);
        ctx = canvas.getContext('2d');

        // Hide old static mesh + any older persistent canvas
        document.querySelectorAll('.neural-mesh-bg').forEach(el => {
            el.style.opacity = '0.15';
            el.style.transition = 'opacity 500ms ease';
        });

        resize();
        window.addEventListener('resize', resize);
    }

    function resize() {
        if (!canvas) return;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        w = canvas.clientWidth = window.innerWidth;
        h = canvas.clientHeight = window.innerHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ---------- Effect factories per mode ----------
    function spawnEffect(x, y) {
        if (respectReduceMotion) return;
        const palette = MODE_PALETTES[currentMode] || MODE_PALETTES.empresarial;
        const now = performance.now();

        // Every mode gets a ripple ring — it's the universal click feedback
        effects.push({
            kind: 'ring', born: now, life: 900,
            x, y, maxR: 160, color: palette.primary, width: 2
        });
        effects.push({
            kind: 'ring', born: now + 90, life: 1100,
            x, y, maxR: 220, color: palette.secondary, width: 1
        });

        // Mode-specific particles
        switch (palette.type) {
            case 'grid': {
                // Digital squares flying outward
                for (let i = 0; i < 14; i++) {
                    const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.3;
                    const s = 3 + Math.random() * 4;
                    effects.push({
                        kind: 'square', born: now, life: 900 + Math.random() * 400,
                        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
                        size: 3 + Math.random() * 4,
                        color: Math.random() < 0.3 ? palette.tertiary : palette.primary,
                        spin: (Math.random() - 0.5) * 0.2
                    });
                }
                break;
            }
            case 'blobs': {
                // Vibrant color burst
                for (let i = 0; i < 32; i++) {
                    const a = Math.random() * Math.PI * 2;
                    const s = 2 + Math.random() * 6;
                    effects.push({
                        kind: 'circle', born: now, life: 900 + Math.random() * 600,
                        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.2,
                        size: 3 + Math.random() * 5,
                        gravity: 0.04,
                        color: [palette.primary, palette.secondary, palette.tertiary][Math.floor(Math.random() * 3)]
                    });
                }
                break;
            }
            case 'waves': {
                // Three concentric sonic pings + warm bubbles
                effects.push({ kind: 'ring', born: now + 200, life: 1300, x, y, maxR: 300, color: palette.primary, width: 2 });
                for (let i = 0; i < 14; i++) {
                    const a = Math.random() * Math.PI * 2;
                    const s = 1 + Math.random() * 2.5;
                    effects.push({
                        kind: 'bubble', born: now, life: 1100 + Math.random() * 500,
                        x, y, vx: Math.cos(a) * s, vy: -1.5 - Math.random() * 2,
                        size: 4 + Math.random() * 6,
                        color: Math.random() < 0.4 ? palette.secondary : palette.primary
                    });
                }
                break;
            }
            case 'petals': {
                // Gentle gold dust rising
                for (let i = 0; i < 18; i++) {
                    const a = Math.random() * Math.PI * 2;
                    const s = 0.5 + Math.random() * 1.2;
                    effects.push({
                        kind: 'petal', born: now, life: 1400 + Math.random() * 800,
                        x, y, vx: Math.cos(a) * s, vy: -0.8 - Math.random() * 1.2,
                        size: 2 + Math.random() * 2.5,
                        drift: Math.random() * Math.PI * 2,
                        driftSpeed: 0.003 + Math.random() * 0.004,
                        color: Math.random() < 0.35 ? palette.secondary : palette.primary
                    });
                }
                break;
            }
        }
        startLoop();
    }

    function startLoop() {
        if (rafId) return;
        rafId = requestAnimationFrame(frame);
    }

    function frame(now) {
        ctx.clearRect(0, 0, w, h);
        let alive = 0;
        for (let i = 0; i < effects.length; i++) {
            const e = effects[i];
            const age = now - e.born;
            if (age < 0) { alive++; continue; }
            const t = age / e.life;
            if (t >= 1) continue;
            alive++;
            drawEffect(e, t, age);
        }
        // Compact active list
        effects = effects.filter(e => (now - e.born) < e.life);

        if (effects.length > 0) {
            rafId = requestAnimationFrame(frame);
        } else {
            cancelAnimationFrame(rafId);
            rafId = null;
            // Final clear
            ctx.clearRect(0, 0, w, h);
        }
    }

    function drawEffect(e, t, age) {
        const fadeOut = 1 - t;
        switch (e.kind) {
            case 'ring': {
                const r = e.maxR * easeOut(t);
                ctx.strokeStyle = hexToRgba(e.color, 0.85 * fadeOut);
                ctx.lineWidth = (e.width || 2) * (1 + fadeOut * 0.3);
                ctx.beginPath();
                ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
                ctx.stroke();
                // Inner echo
                ctx.strokeStyle = hexToRgba(e.color, 0.35 * fadeOut);
                ctx.beginPath();
                ctx.arc(e.x, e.y, r * 0.55, 0, Math.PI * 2);
                ctx.stroke();
                break;
            }
            case 'square': {
                e.x += e.vx;
                e.y += e.vy;
                e.vx *= 0.97; e.vy *= 0.97;
                ctx.save();
                ctx.translate(e.x, e.y);
                ctx.rotate(age * (e.spin || 0.01));
                ctx.fillStyle = hexToRgba(e.color, 0.9 * fadeOut);
                ctx.fillRect(-e.size / 2, -e.size / 2, e.size, e.size);
                ctx.restore();
                break;
            }
            case 'circle': {
                e.x += e.vx;
                e.y += e.vy;
                e.vy += (e.gravity || 0);
                e.vx *= 0.98; e.vy *= 0.98;
                ctx.fillStyle = hexToRgba(e.color, 0.85 * fadeOut);
                ctx.beginPath();
                ctx.arc(e.x, e.y, e.size * (1 - t * 0.35), 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'bubble': {
                e.x += e.vx;
                e.y += e.vy;
                e.vy += 0.02; // gentle buoyancy decay
                e.vx *= 0.99;
                ctx.strokeStyle = hexToRgba(e.color, 0.7 * fadeOut);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(e.x, e.y, e.size * (1 + t * 0.4), 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = hexToRgba(e.color, 0.15 * fadeOut);
                ctx.fill();
                break;
            }
            case 'petal': {
                e.drift += e.driftSpeed;
                e.x += e.vx + Math.sin(e.drift) * 0.4;
                e.y += e.vy;
                ctx.fillStyle = hexToRgba(e.color, 0.9 * fadeOut);
                ctx.beginPath();
                ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
        }
    }

    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
    function hexToRgba(hex, a) {
        const h = hex.replace('#', '');
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${a})`;
    }

    // ---------- Event wiring ----------
    function onClick(e) {
        // Ignore clicks that would trigger a navigation (we still want the effect though)
        ensureCanvas();
        spawnEffect(e.clientX, e.clientY);
    }

    function setMode(mode) {
        currentMode = mode || 'empresarial';
    }

    function initAuto() {
        currentMode = localStorage.getItem('gunter_env') || 'empresarial';
        window.addEventListener('themechange', (e) => {
            if (e.detail && e.detail.theme) setMode(e.detail.theme);
        });
        window.addEventListener('click', onClick, { passive: true, capture: true });
        ensureCanvas();
    }

    window.GunterThemeBackground = { setMode, initAuto, spawnEffect };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuto);
    } else {
        initAuto();
    }
})();
