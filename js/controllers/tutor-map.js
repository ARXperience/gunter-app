/* =============================================
   GUNTER TUTOR — Concept Map (SVG force graph)
   -------------------------------------------------
   Renderiza un grafo con:
     nodes = obras (color = tema dominante)
     edges = cross-refs (grosor = conceptos compartidos)
   Force layout Verlet minimalista (repulsión + resortes + centro).
   ============================================= */
(function () {
    if (window.GunterTutorMap) return;

    const THEME_COLOR = {
        meditation:     '#059669',
        self:           '#7C3AED',
        consciousness:  '#0E7490',
        syntergic:      '#5B21B6',
        shamanism:      '#B45309',
        psychophysio:   '#BE185D',
        reality:        '#0891B2',
        'beyond-language': '#DB2777'
    };

    // Params de la simulación
    const REPULSION       = 3200;   // fuerza push entre pares de nodos
    const SPRING_LEN      = 130;    // longitud "descansada" del resorte
    const SPRING_K        = 0.02;   // rigidez del resorte (edges)
    const CENTER_PULL     = 0.008;
    const DAMPING         = 0.85;
    const MAX_VELOCITY    = 15;
    const ITER_PER_FRAME  = 2;

    let host = null;
    let nodes = [];
    let edges = [];
    let selected = null;
    let running = false;
    let rafId = null;
    let width = 800, height = 520;

    async function mount(selector, workNumbers = null) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gtutor-map');

        const catalog = await window.GunterTutor?.catalog?.();
        if (!catalog) { host.innerHTML = '<p class="gtutor__hint">No pude cargar el catálogo.</p>'; return; }

        // Traer cross-refs de cada obra indexada. Corren en paralelo.
        const works = (catalog.works || []).filter(w => w.hasFile);
        const filter = workNumbers ? new Set(workNumbers.map(String)) : null;
        const workSet = filter ? works.filter(w => filter.has(w.n)) : works;

        const refsAll = await Promise.all(workSet.map(w =>
            window.GunterTutor.sageCrossRefs?.(w.n).catch(() => null)
        ));

        // Build nodes
        nodes = workSet.map((w, i) => {
            const angle = (i / workSet.length) * Math.PI * 2;
            const r = Math.min(width, height) * 0.32;
            return {
                id: w.n,
                title: w.title,
                themes: w.themes || [],
                dominantTheme: (w.themes || [])[0],
                difficulty: w.difficulty,
                x: width / 2 + Math.cos(angle) * r,
                y: height / 2 + Math.sin(angle) * r,
                vx: 0, vy: 0,
                radius: 22
            };
        });
        const nodeIds = new Set(nodes.map(n => n.id));

        // Build edges from refs. Cross-refs son dirigidos, deduplicamos por par.
        const seen = new Set();
        edges = [];
        refsAll.forEach((res, i) => {
            if (!res?.refs) return;
            const fromId = workSet[i].n;
            for (const r of res.refs) {
                if (!nodeIds.has(r.workN)) continue;
                const key = [fromId, r.workN].sort().join('|');
                if (seen.has(key)) continue;
                seen.add(key);
                edges.push({
                    source: fromId,
                    target: r.workN,
                    weight: r.score,
                    shared: r.shared || []
                });
            }
        });

        render();
        start();
    }

    function render() {
        const rect = host.getBoundingClientRect();
        if (rect.width > 0) width = rect.width;

        const svg = `
            <div class="gtutor-map__wrap">
                <svg class="gtutor-map__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
                    <defs>
                        <filter id="gtm-glow" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="4" result="blur"/>
                            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                        </filter>
                    </defs>
                    <g class="gtm-edges">
                        ${edges.map(e => {
                            const s = nodes.find(n => n.id === e.source);
                            const t = nodes.find(n => n.id === e.target);
                            if (!s || !t) return '';
                            const opacity = 0.15 + Math.min(0.5, e.weight * 0.06);
                            const stroke = 0.8 + Math.min(3, e.weight * 0.5);
                            const highlight = (selected && (e.source === selected || e.target === selected));
                            return `<line class="gtm-edge ${highlight ? 'is-highlight' : ''}"
                                data-edge="${e.source}-${e.target}"
                                x1="${s.x}" y1="${s.y}" x2="${t.x}" y2="${t.y}"
                                stroke-width="${stroke}" opacity="${highlight ? 0.9 : opacity}"/>`;
                        }).join('')}
                    </g>
                    <g class="gtm-nodes">
                        ${nodes.map(n => {
                            const color = THEME_COLOR[n.dominantTheme] || '#4B5563';
                            const isSel = selected === n.id;
                            const isNeighbor = selected && edges.some(e =>
                                (e.source === selected && e.target === n.id) ||
                                (e.target === selected && e.source === n.id));
                            const opacity = (selected && !isSel && !isNeighbor) ? 0.35 : 1;
                            const r = isSel ? n.radius + 4 : n.radius;
                            return `
                                <g class="gtm-node ${isSel ? 'is-selected' : ''}" data-node="${n.id}"
                                   transform="translate(${n.x},${n.y})" style="opacity:${opacity}">
                                    <circle r="${r+2}" fill="rgba(0,0,0,0.10)"/>
                                    <circle r="${r}" fill="${color}"
                                            stroke="${isSel ? '#fff' : 'rgba(255,255,255,0.7)'}"
                                            stroke-width="${isSel ? 3 : 2}"
                                            filter="${isSel ? 'url(#gtm-glow)' : ''}"/>
                                    <text class="gtm-label" x="0" y="4" text-anchor="middle"
                                          font-family="Space Grotesk, sans-serif" font-weight="800"
                                          font-size="13" fill="#fff">
                                        #${n.id}
                                    </text>
                                </g>
                            `;
                        }).join('')}
                    </g>
                </svg>
                ${_legend()}
                ${_infoPanel()}
            </div>
        `;
        host.innerHTML = svg;
        wire();
    }

    function _legend() {
        return `
            <div class="gtutor-map__legend">
                <div class="gtutor-map__legend-title">Temas</div>
                ${Object.entries(THEME_COLOR).map(([id, c]) => `
                    <div class="gtutor-map__legend-item">
                        <span class="gtutor-map__legend-dot" style="background:${c}"></span>
                        <span>${id}</span>
                    </div>
                `).join('')}
                <div class="gtutor-map__legend-note">
                    Grosor de línea = fuerza del vínculo. Hovereá o clickeá una obra.
                </div>
            </div>
        `;
    }

    function _infoPanel() {
        if (!selected) return '<div class="gtutor-map__info gtutor-map__info--empty">Elegí una obra para ver sus vínculos y conceptos compartidos.</div>';
        const node = nodes.find(n => n.id === selected);
        if (!node) return '';
        const connections = edges
            .filter(e => e.source === selected || e.target === selected)
            .map(e => {
                const otherId = e.source === selected ? e.target : e.source;
                const other = nodes.find(n => n.id === otherId);
                return { other, weight: e.weight, shared: e.shared };
            })
            .sort((a, b) => b.weight - a.weight);
        return `
            <div class="gtutor-map__info">
                <div class="gtutor-map__info-head">
                    <span class="gtutor__card-n">#${node.id}</span>
                    <h4>${esc(node.title)}</h4>
                </div>
                <div class="gtutor-map__info-actions">
                    <button class="gtutor__btn gtutor__btn--primary gtutor__btn--sm" data-open-work="${node.id}">Ver detalle</button>
                    <button class="gtutor__btn gtutor__btn--sm" data-ask-work="${node.id}">Pregunta al sabio</button>
                </div>
                <div class="gtutor-map__info-title">${connections.length} vínculos</div>
                <ul class="gtutor-map__info-list">
                    ${connections.slice(0, 8).map(c => `
                        <li>
                            <button class="gtutor-map__conn" data-select="${c.other.id}">
                                <span class="gtutor__card-n">#${c.other.id}</span>
                                <span>${esc(c.other.title)}</span>
                            </button>
                            <div class="gtutor-map__shared">${c.shared.slice(0,4).map(t => `<span class="gtutor__t">${esc(t)}</span>`).join('')}</div>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    function wire() {
        host.querySelectorAll('[data-node]').forEach(g => {
            g.addEventListener('click', (e) => {
                selected = e.currentTarget.dataset.node;
                render();
            });
            g.addEventListener('mouseenter', () => {
                if (!selected) {
                    g.style.cursor = 'pointer';
                }
            });
        });
        host.querySelectorAll('[data-select]').forEach(b => {
            b.addEventListener('click', () => { selected = b.dataset.select; render(); });
        });
        host.querySelectorAll('[data-open-work]').forEach(b => {
            b.addEventListener('click', () => {
                if (window.GunterTutorPanel && typeof window.GunterTutorPanel.openWork === 'function') {
                    window.GunterTutorPanel.openWork(b.dataset.openWork);
                }
            });
        });
        host.querySelectorAll('[data-ask-work]').forEach(b => {
            b.addEventListener('click', () => {
                const n = b.dataset.askWork;
                const node = nodes.find(x => x.id === n);
                _ask(`Cuéntame de qué trata #${n} "${node?.title || ''}" y cómo se conecta con las obras vecinas.`);
            });
        });
    }

    // ═════════════════════════════════════════════
    // Simulación física (Verlet mínimo)
    // ═════════════════════════════════════════════
    function step() {
        for (let iter = 0; iter < ITER_PER_FRAME; iter++) {
            // Repulsión pairwise
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const a = nodes[i], b = nodes[j];
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const d2 = Math.max(1, dx * dx + dy * dy);
                    const f = REPULSION / d2;
                    const d = Math.sqrt(d2);
                    const fx = (dx / d) * f, fy = (dy / d) * f;
                    a.vx -= fx; a.vy -= fy;
                    b.vx += fx; b.vy += fy;
                }
            }
            // Resortes (edges)
            for (const e of edges) {
                const s = nodes.find(n => n.id === e.source);
                const t = nodes.find(n => n.id === e.target);
                if (!s || !t) continue;
                const dx = t.x - s.x, dy = t.y - s.y;
                const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                const springForce = SPRING_K * (d - SPRING_LEN) * (1 + Math.min(2, e.weight * 0.3));
                const fx = (dx / d) * springForce, fy = (dy / d) * springForce;
                s.vx += fx; s.vy += fy;
                t.vx -= fx; t.vy -= fy;
            }
            // Atracción al centro
            for (const n of nodes) {
                n.vx += (width / 2 - n.x) * CENTER_PULL;
                n.vy += (height / 2 - n.y) * CENTER_PULL;
                // Damping + max velocity clamp
                n.vx *= DAMPING; n.vy *= DAMPING;
                const v = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
                if (v > MAX_VELOCITY) { n.vx = (n.vx / v) * MAX_VELOCITY; n.vy = (n.vy / v) * MAX_VELOCITY; }
                n.x += n.vx; n.y += n.vy;
                // Boundaries
                const pad = n.radius + 6;
                n.x = Math.max(pad, Math.min(width - pad, n.x));
                n.y = Math.max(pad, Math.min(height - pad, n.y));
            }
        }

        // Actualizar posiciones en el SVG sin re-renderizar todo (más rápido)
        for (const n of nodes) {
            const g = host.querySelector(`[data-node="${n.id}"]`);
            if (g) g.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
        }
        for (const e of edges) {
            const s = nodes.find(n => n.id === e.source);
            const t = nodes.find(n => n.id === e.target);
            const line = host.querySelector(`[data-edge="${e.source}-${e.target}"]`);
            if (line && s && t) {
                line.setAttribute('x1', s.x.toFixed(1));
                line.setAttribute('y1', s.y.toFixed(1));
                line.setAttribute('x2', t.x.toFixed(1));
                line.setAttribute('y2', t.y.toFixed(1));
            }
        }
    }

    let iterCount = 0;
    function loop() {
        if (!running) return;
        step();
        iterCount++;
        // Después de ~250 frames el layout se estabiliza — pausamos para ahorrar CPU
        if (iterCount > 250) { stop(); return; }
        rafId = requestAnimationFrame(loop);
    }

    function start() {
        if (running) return;
        running = true; iterCount = 0;
        rafId = requestAnimationFrame(loop);
    }

    function stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }
    function _ask(text) {
        if (window.GunterCompanion?.__handleFromWake) window.GunterCompanion.__handleFromWake(text);
    }

    window.GunterTutorMap = { mount, stop };
})();
