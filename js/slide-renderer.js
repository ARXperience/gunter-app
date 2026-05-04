/* =============================================
   GUNTER APP - Slide Renderer (Editorial Edition)
   -------------------------------------------------
   Pantalla completa con composición editorial,
   tipografía escalada, transiciones suaves y
   layouts variables para evitar la monotonía.
   ============================================= */

(function () {
    let state = {
        deck: null,
        index: 0,
        container: null,
        keyHandler: null
    };

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function applyPalette(root, style) {
        const p = style.palette;
        root.style.setProperty('--slide-bg', p.bg);
        root.style.setProperty('--slide-surface', p.surface);
        root.style.setProperty('--slide-accent', p.accent);
        root.style.setProperty('--slide-text', p.text);
        root.style.setProperty('--slide-muted', p.muted);
        root.style.setProperty('--slide-font-heading', style.typography.heading);
        root.style.setProperty('--slide-font-body', style.typography.body);
    }

    // Alternate layouts so consecutive slides don't feel identical.
    function pickLayout(type, index) {
        if (type === 'cover' || type === 'closing') return 'hero';
        if (type === 'section') return 'hero';
        if (type === 'quote') return 'pull-quote';
        if (type === 'kpi') return 'kpi-hero';
        // bullets alternate left/right
        return index % 2 === 0 ? 'editorial-left' : 'editorial-right';
    }

    function renderImage(slide, layout) {
        if (slide.imageUrl) {
            return `<div class="gslide-image" style="background-image:url('${slide.imageUrl.replace(/'/g, "\\'")}');"></div>`;
        }
        return `<div class="gslide-image gslide-image--placeholder">
            <div class="gslide-image-fallback"><span class="gslide-mark">✦</span></div>
        </div>`;
    }

    // ---------- Templates ----------
    function renderSlide(slide, deck, i, total) {
        const type = slide.type || 'bullets';
        const layout = pickLayout(type, i);
        const img = renderImage(slide, layout);
        const index = String(i + 1).padStart(2, '0');

        let content;
        switch (layout) {
            case 'hero':
                content = `
                    <div class="gslide-hero">
                        <span class="gslide-eyebrow">${escapeHtml(slide.footer || (type === 'cover' ? 'Presentación estratégica' : type === 'closing' ? 'Cierre' : 'Capítulo'))}</span>
                        <h1 class="gslide-title gslide-title--xxl">${escapeHtml(slide.title || deck.title || '')}</h1>
                        ${slide.subtitle || deck.subtitle ? `<p class="gslide-lead">${escapeHtml(slide.subtitle || deck.subtitle)}</p>` : ''}
                        ${slide.bullets && slide.bullets.length ? `
                            <ul class="gslide-pills">${slide.bullets.slice(0, 4).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ''}
                    </div>`;
                break;

            case 'pull-quote':
                content = `
                    <div class="gslide-quote-wrap">
                        <span class="gslide-eyebrow">${escapeHtml(slide.subtitle || 'Cita destacada')}</span>
                        <blockquote class="gslide-quote">
                            <span class="gslide-quote-mark">“</span>
                            <span>${escapeHtml(slide.quote || slide.title || '')}</span>
                        </blockquote>
                        ${slide.title && slide.quote ? `<cite class="gslide-cite">— ${escapeHtml(slide.title)}</cite>` : ''}
                    </div>`;
                break;

            case 'kpi-hero':
                content = `
                    <div class="gslide-kpi-wrap">
                        <span class="gslide-eyebrow">${escapeHtml(slide.subtitle || 'Métrica ancla')}</span>
                        <h2 class="gslide-title">${escapeHtml(slide.title || '')}</h2>
                        ${slide.metric ? `
                            <div class="gslide-kpi">
                                <span class="gslide-kpi-value">${escapeHtml(slide.metric.value || '—')}</span>
                                <span class="gslide-kpi-label">${escapeHtml(slide.metric.label || '')}</span>
                            </div>` : ''}
                        ${slide.bullets && slide.bullets.length ? `
                            <ul class="gslide-bullets">${slide.bullets.slice(0, 3).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ''}
                    </div>`;
                break;

            case 'editorial-left':
            case 'editorial-right':
            default:
                content = `
                    <div class="gslide-editorial">
                        <span class="gslide-eyebrow">${escapeHtml(slide.subtitle || slide.footer || 'Punto clave')}</span>
                        <h2 class="gslide-title">${escapeHtml(slide.title || '')}</h2>
                        ${slide.bullets && slide.bullets.length ? `
                            <ul class="gslide-bullets">${slide.bullets.slice(0, 5).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ''}
                    </div>`;
                break;
        }

        return `
            <div class="gslide gslide--${type} gslide--layout-${layout}" data-index="${i}">
                ${img}
                <div class="gslide-scrim gslide-scrim--${layout}"></div>
                <div class="gslide-inner">
                    ${content}
                </div>
                <div class="gslide-footer">
                    <span class="gslide-project">${escapeHtml(deck.title || '')}</span>
                    <span class="gslide-index">${index} <span class="gslide-total">/ ${total}</span></span>
                </div>
                <div class="gslide-accent-bar"></div>
            </div>
        `;
    }

    function injectStyles() {
        if (document.getElementById('gslide-styles')) return;
        const css = document.createElement('style');
        css.id = 'gslide-styles';
        css.textContent = `
            .gslide-host {
                position: fixed; inset: 0;
                background: var(--slide-bg, #000);
                color: var(--slide-text, #fff);
                z-index: 99999;
                display: flex; flex-direction: column;
                font-family: var(--slide-font-body, 'Inter', sans-serif);
                -webkit-font-smoothing: antialiased;
            }
            .gslide-stage { position: relative; flex: 1; overflow: hidden; }

            .gslide {
                position: absolute; inset: 0;
                opacity: 0;
                transform: scale(1.015);
                transition: opacity 500ms cubic-bezier(.22,.61,.36,1), transform 700ms cubic-bezier(.22,.61,.36,1);
                pointer-events: none;
                will-change: opacity, transform;
            }
            .gslide.is-active { opacity: 1; transform: scale(1); pointer-events: auto; }
            .gslide.is-active .gslide-inner > * {
                animation: gslideContentIn 700ms cubic-bezier(.22,.61,.36,1) both;
            }
            @keyframes gslideContentIn {
                from { opacity: 0; transform: translateY(24px); }
                to   { opacity: 1; transform: translateY(0); }
            }

            .gslide-image {
                position: absolute; inset: 0;
                background-size: cover; background-position: center;
                z-index: 0;
                filter: saturate(1.05);
            }
            .gslide.is-active .gslide-image {
                animation: gslideImageZoom 14s ease-out forwards;
            }
            @keyframes gslideImageZoom {
                from { transform: scale(1.0); }
                to   { transform: scale(1.08); }
            }
            .gslide-image--placeholder {
                background:
                    radial-gradient(ellipse at 30% 40%, color-mix(in srgb, var(--slide-accent) 35%, transparent), transparent 55%),
                    radial-gradient(ellipse at 80% 80%, color-mix(in srgb, var(--slide-accent) 18%, transparent), transparent 60%),
                    linear-gradient(135deg, var(--slide-surface), var(--slide-bg));
                display:flex; align-items:center; justify-content:center;
            }
            .gslide-mark {
                font-size: 140px; opacity: 0.18; color: var(--slide-accent);
                font-family: var(--slide-font-heading);
            }

            /* Scrims per layout for legibility */
            .gslide-scrim { position: absolute; inset: 0; z-index: 1; }
            .gslide-scrim--editorial-left   { background: linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.65) 35%, rgba(0,0,0,0.12) 70%, transparent 100%); }
            .gslide-scrim--editorial-right  { background: linear-gradient(270deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.65) 35%, rgba(0,0,0,0.12) 70%, transparent 100%); }
            .gslide-scrim--hero             { background: radial-gradient(ellipse at center, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.85) 75%); }
            .gslide-scrim--pull-quote       { background: radial-gradient(ellipse at center, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.88) 75%); }
            .gslide-scrim--kpi-hero         { background: linear-gradient(135deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.1) 100%); }

            .gslide-inner {
                position: relative; z-index: 2;
                height: 100%;
                display: flex; flex-direction: column;
                padding: 72px 88px;
                box-sizing: border-box;
            }

            /* Layouts */
            .gslide--layout-editorial-left  .gslide-inner { justify-content: center; align-items: flex-start; }
            .gslide--layout-editorial-right .gslide-inner { justify-content: center; align-items: flex-end; text-align: right; }
            .gslide--layout-editorial-right .gslide-bullets li { text-align: left; }
            .gslide--layout-hero            .gslide-inner { justify-content: center; align-items: center; text-align: center; }
            .gslide--layout-pull-quote      .gslide-inner { justify-content: center; align-items: center; text-align: center; }
            .gslide--layout-kpi-hero        .gslide-inner { justify-content: center; align-items: flex-start; }

            .gslide-hero, .gslide-editorial, .gslide-kpi-wrap, .gslide-quote-wrap { max-width: 780px; }
            .gslide-hero { max-width: 960px; }

            /* Typography scale */
            .gslide-eyebrow {
                display: inline-block;
                font-size: 11px;
                letter-spacing: 3.5px;
                text-transform: uppercase;
                color: var(--slide-accent);
                margin-bottom: 20px;
                position: relative;
                padding-left: 28px;
                font-weight: 600;
            }
            .gslide-eyebrow::before {
                content: ''; position: absolute; left: 0; top: 50%;
                width: 20px; height: 1px; background: var(--slide-accent);
                transform: translateY(-50%);
            }
            .gslide--layout-editorial-right .gslide-eyebrow { padding-left: 0; padding-right: 28px; }
            .gslide--layout-editorial-right .gslide-eyebrow::before { left: auto; right: 0; }
            .gslide--layout-hero .gslide-eyebrow { padding: 0; }
            .gslide--layout-hero .gslide-eyebrow::before { display: none; }

            .gslide-title {
                font-family: var(--slide-font-heading);
                font-weight: 700;
                line-height: 1.04;
                margin: 0 0 20px;
                font-size: clamp(36px, 4.8vw, 64px);
                letter-spacing: -0.02em;
                color: var(--slide-text);
            }
            .gslide-title--xxl {
                font-size: clamp(52px, 7vw, 104px);
                line-height: 0.98;
                letter-spacing: -0.035em;
                font-weight: 800;
                background: linear-gradient(135deg, var(--slide-text) 20%, var(--slide-accent) 100%);
                -webkit-background-clip: text;
                background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .gslide-lead {
                font-size: clamp(18px, 1.6vw, 24px);
                color: var(--slide-muted);
                line-height: 1.5;
                max-width: 720px;
                margin: 0 auto;
            }
            .gslide--layout-editorial-left .gslide-lead,
            .gslide--layout-editorial-right .gslide-lead,
            .gslide--layout-kpi-hero .gslide-lead { margin: 0; }

            /* Bullets */
            .gslide-bullets {
                list-style: none; padding: 0;
                margin: 28px 0 0;
                display: flex; flex-direction: column;
                gap: 14px;
            }
            .gslide-bullets li {
                position: relative;
                padding: 14px 22px 14px 48px;
                font-size: clamp(15px, 1.25vw, 19px);
                line-height: 1.45;
                color: var(--slide-text);
                background: color-mix(in srgb, var(--slide-surface) 55%, transparent);
                border-radius: 10px;
                backdrop-filter: blur(14px);
                -webkit-backdrop-filter: blur(14px);
                border: 1px solid color-mix(in srgb, var(--slide-accent) 18%, transparent);
                transition: transform 300ms ease, border-color 300ms ease;
            }
            .gslide-bullets li::before {
                content: '';
                position: absolute; left: 20px; top: 50%;
                transform: translateY(-50%);
                width: 10px; height: 10px; border-radius: 50%;
                background: var(--slide-accent);
                box-shadow: 0 0 16px color-mix(in srgb, var(--slide-accent) 70%, transparent);
            }
            .gslide.is-active .gslide-bullets li {
                animation: gslideBullet 500ms cubic-bezier(.22,.61,.36,1) both;
            }
            .gslide.is-active .gslide-bullets li:nth-child(1) { animation-delay: 150ms; }
            .gslide.is-active .gslide-bullets li:nth-child(2) { animation-delay: 230ms; }
            .gslide.is-active .gslide-bullets li:nth-child(3) { animation-delay: 310ms; }
            .gslide.is-active .gslide-bullets li:nth-child(4) { animation-delay: 390ms; }
            .gslide.is-active .gslide-bullets li:nth-child(5) { animation-delay: 470ms; }
            @keyframes gslideBullet {
                from { opacity: 0; transform: translateX(-12px); }
                to { opacity: 1; transform: translateX(0); }
            }

            /* Pills for hero lists */
            .gslide-pills {
                list-style: none; padding: 0;
                margin: 32px 0 0;
                display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;
            }
            .gslide-pills li {
                padding: 10px 20px;
                font-size: 14px; font-weight: 500;
                color: var(--slide-text);
                background: color-mix(in srgb, var(--slide-surface) 70%, transparent);
                border: 1px solid color-mix(in srgb, var(--slide-accent) 30%, transparent);
                border-radius: 999px;
            }

            /* KPI block */
            .gslide-kpi { margin: 32px 0 20px; }
            .gslide-kpi-value {
                display: block;
                font-family: var(--slide-font-heading);
                font-size: clamp(96px, 14vw, 200px);
                font-weight: 800;
                line-height: 0.9;
                letter-spacing: -0.04em;
                color: var(--slide-accent);
                text-shadow: 0 0 80px color-mix(in srgb, var(--slide-accent) 50%, transparent);
            }
            .gslide-kpi-label {
                display: block;
                margin-top: 12px;
                font-size: 13px;
                letter-spacing: 3px;
                text-transform: uppercase;
                color: var(--slide-muted);
                font-weight: 600;
            }

            /* Quote */
            .gslide-quote-wrap { max-width: 1000px; }
            .gslide-quote {
                font-family: var(--slide-font-heading);
                font-size: clamp(32px, 4.2vw, 56px);
                line-height: 1.18;
                font-weight: 500;
                font-style: italic;
                margin: 0;
                position: relative;
                letter-spacing: -0.01em;
            }
            .gslide-quote-mark {
                display: block;
                font-size: clamp(80px, 10vw, 160px);
                line-height: 0.5;
                color: var(--slide-accent);
                font-family: var(--slide-font-heading);
                margin-bottom: 4px;
                opacity: 0.7;
            }
            .gslide-cite {
                display: block;
                margin-top: 28px;
                color: var(--slide-muted);
                font-size: 15px;
                letter-spacing: 2px;
                text-transform: uppercase;
                font-style: normal;
            }

            /* Footer */
            .gslide-footer {
                position: absolute;
                bottom: 0; left: 0; right: 0;
                z-index: 3;
                display: flex; justify-content: space-between; align-items: center;
                padding: 20px 88px;
                font-size: 11px;
                letter-spacing: 2px;
                text-transform: uppercase;
                color: var(--slide-muted);
                border-top: 1px solid color-mix(in srgb, var(--slide-muted) 20%, transparent);
                background: linear-gradient(to top, color-mix(in srgb, var(--slide-bg) 85%, transparent), transparent);
            }
            .gslide-index { font-family: var(--slide-font-heading); font-weight: 600; }
            .gslide-total { color: var(--slide-muted); opacity: 0.6; }

            /* Accent bar at top */
            .gslide-accent-bar {
                position: absolute; top: 0; left: 0;
                height: 4px;
                width: 100%;
                background: linear-gradient(90deg, var(--slide-accent) 0%, transparent 100%);
                opacity: 0.85;
                z-index: 3;
            }

            /* Controls */
            .gslide-controls {
                display: flex; justify-content: space-between; align-items: center;
                padding: 14px 36px;
                background: color-mix(in srgb, var(--slide-surface) 85%, transparent);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border-top: 1px solid color-mix(in srgb, var(--slide-muted) 25%, transparent);
                z-index: 5;
            }
            .gslide-dots { display: flex; gap: 7px; }
            .gslide-dot {
                width: 7px; height: 7px; border-radius: 50%;
                background: color-mix(in srgb, var(--slide-muted) 35%, transparent);
                cursor: pointer; border: none; padding: 0;
                transition: all 250ms ease;
            }
            .gslide-dot:hover { background: var(--slide-muted); }
            .gslide-dot.is-active {
                background: var(--slide-accent);
                width: 24px; border-radius: 999px;
                box-shadow: 0 0 12px color-mix(in srgb, var(--slide-accent) 60%, transparent);
            }
            .gslide-btn {
                background: transparent;
                border: 1px solid color-mix(in srgb, var(--slide-muted) 40%, transparent);
                color: var(--slide-text);
                padding: 9px 18px; border-radius: 8px;
                cursor: pointer;
                font-family: inherit; font-size: 13px; font-weight: 500;
                transition: all 200ms ease;
                letter-spacing: 0.3px;
            }
            .gslide-btn:hover {
                border-color: var(--slide-accent);
                color: var(--slide-accent);
                background: color-mix(in srgb, var(--slide-accent) 8%, transparent);
            }
            .gslide-close {
                position: absolute; top: 18px; right: 18px; z-index: 100;
                padding: 8px 14px;
            }
            .gslide-hint {
                position: absolute; bottom: 72px; left: 50%;
                transform: translateX(-50%);
                color: var(--slide-muted);
                font-size: 10px;
                letter-spacing: 3px;
                text-transform: uppercase;
                opacity: 0.5;
                pointer-events: none;
                z-index: 4;
            }

            /* Export buttons + toast */
            .gslide-export { display: flex; gap: 8px; margin-left: auto; margin-right: 12px; }
            .gslide-btn--export {
                padding: 9px 14px;
                font-size: 12px;
                letter-spacing: 0.5px;
                background: color-mix(in srgb, var(--slide-accent) 12%, transparent);
                border-color: color-mix(in srgb, var(--slide-accent) 50%, transparent);
                color: var(--slide-accent);
            }
            .gslide-btn--export:hover {
                background: color-mix(in srgb, var(--slide-accent) 22%, transparent);
                border-color: var(--slide-accent);
                color: var(--slide-text);
            }
            .gslide-toast {
                position: fixed;
                bottom: 96px; left: 50%;
                transform: translateX(-50%);
                padding: 12px 20px;
                background: color-mix(in srgb, var(--slide-bg, #000) 85%, transparent);
                color: var(--slide-text, #fff);
                border: 1px solid color-mix(in srgb, var(--slide-accent, #fff) 35%, transparent);
                border-radius: 999px;
                font-size: 13px;
                font-family: var(--slide-font-body, 'Inter', sans-serif);
                letter-spacing: 0.3px;
                z-index: 100001;
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                animation: gslideToastIn 220ms ease-out both;
            }
            @keyframes gslideToastIn {
                from { opacity: 0; transform: translate(-50%, 12px); }
                to   { opacity: 1; transform: translate(-50%, 0); }
            }
            .gslide-toast--ok  { border-color: rgba(74,222,128,0.55); color: #4ade80; }
            .gslide-toast--err { border-color: rgba(248,113,113,0.55); color: #fca5a5; }

            /* Smaller screens */
            @media (max-width: 900px) {
                .gslide-inner { padding: 40px 28px; }
                .gslide-footer { padding: 16px 28px; }
                .gslide-bullets li { font-size: 14px; padding: 12px 16px 12px 40px; }
                .gslide-bullets li::before { left: 14px; }
                .gslide-export { display: none; }   /* en mobile no exportamos: pantalla muy chica */
            }
        `;
        document.head.appendChild(css);
    }

    // ---------- Export ----------
    let exporting = false;
    async function doExport(kind) {
        if (exporting || !state.deck) return;
        if (!window.GunterSlideExport) {
            showToast('Falta el módulo de exportación.', 'err');
            return;
        }
        exporting = true;
        const toast = showToast(`Exportando ${kind.toUpperCase()}…`, 'info', { sticky: true });
        try {
            if (kind === 'pdf') {
                await window.GunterSlideExport.toPDF(state.deck);
            } else {
                await window.GunterSlideExport.toPPTX(state.deck);
            }
            toast.update(`✓ ${kind.toUpperCase()} descargado`, 'ok');
            setTimeout(() => toast.dismiss(), 2200);
        } catch (e) {
            console.error('[slide-export] failed:', e);
            toast.update(`⚠ ${e.message || 'Error al exportar'}`, 'err');
            setTimeout(() => toast.dismiss(), 4000);
        } finally {
            exporting = false;
        }
    }

    function showToast(message, kind = 'info', { sticky = false } = {}) {
        const host = state.container || document.body;
        const el = document.createElement('div');
        el.className = `gslide-toast gslide-toast--${kind}`;
        el.textContent = message;
        host.appendChild(el);
        if (!sticky) setTimeout(() => el.remove(), 2400);
        return {
            update: (msg, k) => {
                el.textContent = msg;
                if (k) el.className = `gslide-toast gslide-toast--${k}`;
            },
            dismiss: () => el.remove()
        };
    }

    // ---------- Public API ----------
    function open(deck) {
        injectStyles();
        close();

        const host = document.createElement('div');
        host.className = 'gslide-host';
        applyPalette(host, deck.style);

        const total = deck.slides.length;
        const slidesHtml = deck.slides.map((s, i) => renderSlide(s, deck, i, total)).join('');

        host.innerHTML = `
            <div class="gslide-stage" id="gslide-stage">
                ${slidesHtml}
                <div class="gslide-hint">← → navegar · Esc salir · F pantalla completa</div>
            </div>
            <div class="gslide-controls">
                <button class="gslide-btn" id="gslide-prev">← Anterior</button>
                <div class="gslide-dots" id="gslide-dots">
                    ${deck.slides.map((_, i) => `<button class="gslide-dot" data-i="${i}" title="Ir a ${i + 1}"></button>`).join('')}
                </div>
                <div class="gslide-export">
                    <button class="gslide-btn gslide-btn--export" id="gslide-export-pdf" title="Exportar como PDF">⬇ PDF</button>
                    <button class="gslide-btn gslide-btn--export" id="gslide-export-pptx" title="Exportar como PowerPoint editable">⬇ PPTX</button>
                </div>
                <button class="gslide-btn" id="gslide-next">Siguiente →</button>
            </div>
            <button class="gslide-btn gslide-close" id="gslide-close" title="Cerrar (Esc)">✕ Cerrar</button>
        `;
        document.body.appendChild(host);
        state.container = host;
        state.deck = deck;
        state.index = 0;
        update();

        host.querySelector('#gslide-prev').addEventListener('click', prev);
        host.querySelector('#gslide-next').addEventListener('click', next);
        host.querySelector('#gslide-close').addEventListener('click', close);
        host.querySelectorAll('.gslide-dot').forEach(d => {
            d.addEventListener('click', () => go(parseInt(d.dataset.i, 10)));
        });
        host.querySelector('#gslide-export-pdf').addEventListener('click', () => doExport('pdf'));
        host.querySelector('#gslide-export-pptx').addEventListener('click', () => doExport('pptx'));

        state.keyHandler = (e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') next();
            else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
            else if (e.key && e.key.toLowerCase() === 'f') toggleFullscreen();
        };
        window.addEventListener('keydown', state.keyHandler);

        try { host.requestFullscreen && host.requestFullscreen().catch(() => { }); } catch { }
    }

    function close() {
        if (state.container) {
            try { document.fullscreenElement && document.exitFullscreen(); } catch { }
            state.container.remove();
        }
        if (state.keyHandler) window.removeEventListener('keydown', state.keyHandler);
        state = { deck: null, index: 0, container: null, keyHandler: null };
    }

    function toggleFullscreen() {
        if (!state.container) return;
        if (document.fullscreenElement) document.exitFullscreen();
        else state.container.requestFullscreen && state.container.requestFullscreen();
    }

    function go(i) {
        if (!state.deck) return;
        const n = state.deck.slides.length;
        state.index = Math.max(0, Math.min(n - 1, i));
        update();
    }
    function next() { go(state.index + 1); }
    function prev() { go(state.index - 1); }

    function update() {
        if (!state.container || !state.deck) return;
        const stage = state.container.querySelector('#gslide-stage');
        stage.querySelectorAll('.gslide').forEach((el, i) => el.classList.toggle('is-active', i === state.index));
        state.container.querySelectorAll('.gslide-dot').forEach((d, i) => d.classList.toggle('is-active', i === state.index));
    }

    window.GunterSlideRenderer = { open, close, next, prev, go };
})();
