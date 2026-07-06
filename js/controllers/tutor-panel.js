/* =============================================
   GUNTER TUTOR PANEL (day.html tab)
   -------------------------------------------------
   Vista de biblioteca curada + curricula + sesión activa.
   Comunica con /api/tutor via GunterTutor client service.
   ============================================= */
(function () {
    if (window.GunterTutorPanel) return;

    let host = null;
    let cat = null;
    let sess = null;
    let sageStatus = null;   // v23: estado del motor sabio
    let activeView = 'library'; // library | curricula | search | concepts | session
    let searchQuery = '';
    let searchResult = null;   // { primaryHits, relatedBooks, termExperts, queryTokens }
    let synthQuery = '';
    let synthResult = null;    // { contributingBooks, expansionTerms, allHits }
    let selectedWorkN = null;  // para modo detalle
    let workConceptsCache = {}; // workN → concepts (lazy)
    let workDigestCache = {};   // workN → digest (lazy)

    // v28 Study Session state
    let studySession = null;    // { workN, digest, stepIdx, totalSteps, phase }

    async function mount(selector = '#gday-tutor') {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gtutor');
        await refresh();
    }

    async function refresh() {
        if (!window.GunterTutor) {
            host.innerHTML = _error('El módulo tutor no está cargado. Recargá la página.');
            return;
        }
        cat  = await window.GunterTutor.catalog();
        sess = await window.GunterTutor.session();
        sageStatus = await window.GunterTutor.sageStatus?.().catch(() => null);
        render();
    }

    function render() {
        if (!cat) {
            host.innerHTML = _error('No pude cargar el catálogo. Revisá que el server esté corriendo.');
            return;
        }
        const sageBadge = sageStatus?.loaded
            ? `<span class="gtutor__chip gtutor__chip--sage" title="Motor sabio activo — indexó ${sageStatus.chunks} chunks">🧠 Sabio: ${sageStatus.chunks} pasajes · ${(sageStatus.vocab/1000).toFixed(0)}k conceptos</span>`
            : `<span class="gtutor__chip">🧠 Sabio: no indexado</span>`;

        host.innerHTML = `
            <header class="gtutor__hero">
                <div class="gtutor__author-mark">📚</div>
                <div class="gtutor__hero-body">
                    <div class="gtutor__eyebrow">MODO SABIO / TUTOR</div>
                    <h1 class="gtutor__title">${esc(cat.author.name)}</h1>
                    <p class="gtutor__author-bio">${esc(cat.author.bio)}</p>
                    <div class="gtutor__hero-meta">
                        <span class="gtutor__chip">${cat.filesOnDisk}/${cat.totalWorks} obras</span>
                        <span class="gtutor__chip">${cat.curricula.length} rutas</span>
                        ${sageBadge}
                        ${sess?.currentWorkMeta ? `<span class="gtutor__chip gtutor__chip--accent">📖 En curso: ${esc(sess.currentWorkMeta.title)}</span>` : ''}
                    </div>
                </div>
            </header>

            <nav class="gtutor__tabs">
                ${_tab('library',   '📖 Biblioteca')}
                ${_tab('curricula', '🎯 Rutas')}
                ${_tab('search',    '🔎 Consulta')}
                ${_tab('synth',     '🔬 Síntesis')}
                ${_tab('concepts',  '💡 Conceptos')}
                ${_tab('map',       '🕸️ Mapa')}
                ${_tab('repaso',    '🔁 Repaso' + _repasoBadge())}
                ${_tab('trivia',    '🎮 Trivia')}
                ${_tab('reflect',   '🪞 Reflejar')}
                ${_tab('session',   '🌱 Progreso')}
            </nav>

            <div class="gtutor__view" data-view="${activeView}">
                ${studySession
                    ? _viewStudySession()
                    : (selectedWorkN
                        ? _viewWorkDetail(selectedWorkN)
                        : (activeView === 'library'   ? _viewLibrary()   :
                           activeView === 'curricula' ? _viewCurricula() :
                           activeView === 'search'    ? _viewSearch()    :
                           activeView === 'synth'     ? _viewSynth()     :
                           activeView === 'concepts'  ? _viewConcepts()  :
                           activeView === 'map'       ? _viewMap()       :
                           activeView === 'repaso'    ? _viewRepaso()    :
                           activeView === 'trivia'    ? _viewTrivia()    :
                           activeView === 'reflect'   ? _viewReflect()   :
                           activeView === 'session'   ? _viewSession()   : ''))}
            </div>
        `;
        wire();

        // Mount el mapa si es esa vista (post-DOM injection)
        if (activeView === 'map' && !selectedWorkN) {
            const mapHost = host.querySelector('#gtutor-map-canvas');
            if (mapHost && window.GunterTutorMap?.mount) {
                window.GunterTutorMap.mount(mapHost);
            }
        }
    }

    // Método público — permite abrir una obra desde otros controladores (ej. tutor-map)
    function openWork(n) {
        selectedWorkN = String(n);
        render();
    }

    function _viewMap() {
        return `
            <div class="gtutor__map-container">
                <p class="gtutor__hint">Grafo de las <strong>${cat.works.filter(w => w.hasFile).length} obras con texto</strong> y sus cross-refs (BM25 + conceptos compartidos). Colores por tema dominante. Click en un nodo para explorar sus vínculos.</p>
                <div id="gtutor-map-canvas" class="gtutor__map-canvas"></div>
            </div>
        `;
    }

    function _tab(id, label) {
        const active = activeView === id ? 'is-active' : '';
        return `<button class="gtutor__tab ${active}" data-view="${id}">${label}</button>`;
    }

    function _viewLibrary() {
        const themes = cat.themesRoot || [];
        return `
            <div class="gtutor__themes">
                ${themes.map(t => `<span class="gtutor__theme-chip" data-theme="${t.id}">${esc(t.label)}</span>`).join('')}
            </div>
            <div class="gtutor__grid">
                ${cat.works.map(w => _workCard(w)).join('')}
            </div>
        `;
    }

    function _workCard(w) {
        const done = sess?.chapters?.[w.n]?.length || 0;
        const cls = w.hasFile ? '' : 'gtutor__card--nofile';
        const diffClr = { principiante: 'gtutor__diff--easy', intermedio: 'gtutor__diff--mid', avanzado: 'gtutor__diff--hard' }[w.difficulty] || '';
        return `
            <article class="gtutor__card ${cls}" data-work="${w.n}">
                <header class="gtutor__card-head">
                    <span class="gtutor__card-n">#${w.n}</span>
                    <span class="gtutor__diff ${diffClr}">${w.difficulty}</span>
                </header>
                <h3 class="gtutor__card-title gtutor__card-title--click" data-action="open-work" data-work="${w.n}">${esc(w.title)}</h3>
                <div class="gtutor__card-themes">${(w.themes||[]).map(t => `<span class="gtutor__t">${esc(t)}</span>`).join('')}</div>
                ${done > 0 ? `<div class="gtutor__progress">${done} capítulos vistos</div>` : ''}
                <div class="gtutor__card-actions">
                    <button data-action="start" data-work="${w.n}" class="gtutor__btn gtutor__btn--primary">Empezar</button>
                    <button data-action="open-work" data-work="${w.n}" class="gtutor__btn">Detalle</button>
                </div>
                ${!w.hasFile ? '<div class="gtutor__flag-nofile">⚠ escaneado</div>' : ''}
            </article>
        `;
    }

    function _viewCurricula() {
        return `
            <div class="gtutor__curricula">
                ${cat.curricula.map(c => `
                    <article class="gtutor__curriculum">
                        <h3 class="gtutor__cur-title">${esc(c.label)}</h3>
                        <p class="gtutor__cur-desc">${esc(c.description)}</p>
                        <ol class="gtutor__cur-path">
                            ${c.path.map(n => {
                                const w = cat.works.find(x => x.n === n);
                                return w ? `<li><span class="gtutor__cur-n">#${w.n}</span> ${esc(w.title)}</li>` : `<li>#${n}</li>`;
                            }).join('')}
                        </ol>
                        <button class="gtutor__btn gtutor__btn--primary" data-action="start-curriculum" data-cur="${c.id}">Empezar ruta</button>
                    </article>
                `).join('')}
            </div>
        `;
    }

    function _viewSearch() {
        const suggestions = [
            'teoría sintégica', 'meditación taoísta', 'Pachita cirugía',
            'campo neuronal unificado', 'yo como idea', 'visión extra ocular',
            'chamanismo mexicano', 'realidad construida'
        ];
        return `
            <div class="gtutor__search">
                <form class="gtutor__search-form" data-action="search-submit">
                    <input type="text" class="gtutor__search-input"
                           placeholder="Consultá al sabio — ej. 'campo unificado y meditación', 'diferencia entre yo y ser'"
                           value="${esc(searchQuery)}" autofocus>
                    <button type="submit" class="gtutor__btn gtutor__btn--primary">Consultar</button>
                </form>

                ${!searchResult ? `
                    <div class="gtutor__search-empty">
                        <p class="gtutor__hint">El sabio busca en <strong>${sageStatus?.chunks || '—'} pasajes semánticos</strong> con BM25 + referencias cruzadas entre libros.</p>
                        <div class="gtutor__suggest">
                            <span class="gtutor__hint">Probá:</span>
                            ${suggestions.map(s => `<button class="gtutor__suggest-btn" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}
                        </div>
                    </div>
                ` : ''}

                ${searchResult && (!searchResult.primaryHits || searchResult.primaryHits.length === 0) ? `
                    <div class="gtutor__search-empty">
                        <p class="gtutor__hint">No encontré pasajes fuertes para eso — probá reformular. Términos que reconocí: <em>${(searchResult.queryTokens||[]).join(', ') || 'ninguno'}</em>.</p>
                    </div>
                ` : ''}

                ${searchResult?.primaryHits?.length ? `
                    <div class="gtutor__search-meta">
                        <span class="gtutor__hint">Analicé <strong>${searchResult.candidatesConsidered}</strong> chunks candidatos (de ${searchResult.stats?.chunksTotal || '?'} totales). Términos clave: <em>${(searchResult.queryTokens||[]).join(', ')}</em>.</span>
                    </div>

                    <h4 class="gtutor__section-h">Pasajes más relevantes</h4>
                    <div class="gtutor__hits">
                        ${searchResult.primaryHits.map((h, i) => `
                            <article class="gtutor__hit">
                                <header class="gtutor__hit-head">
                                    <span class="gtutor__hit-n">#${h.workN} · p.${h.pageStart}${h.pageEnd !== h.pageStart ? '–'+h.pageEnd : ''}</span>
                                    <span class="gtutor__hit-score">BM25 ${h.score}</span>
                                </header>
                                <h4 class="gtutor__hit-title">${esc(h.workTitle)}</h4>
                                <p class="gtutor__hit-snippet">${highlight(h.snippet, searchResult.queryTokens || [])}</p>
                                <div class="gtutor__hit-actions">
                                    <button class="gtutor__btn gtutor__btn--sm" data-action="narrate-passage" data-text="${esc(h.snippet)}">🔊</button>
                                    <button class="gtutor__btn gtutor__btn--sm" data-action="explain-here" data-work="${h.workN}" data-page="${h.pageStart}">Que Gunter me lo explique</button>
                                    <button class="gtutor__btn gtutor__btn--sm" data-action="open-work" data-work="${h.workN}">Ver obra</button>
                                </div>
                            </article>
                        `).join('')}
                    </div>

                    ${searchResult.relatedBooks?.length ? `
                        <h4 class="gtutor__section-h">📚 Libros relacionados (comparten conceptos)</h4>
                        <div class="gtutor__related">
                            ${searchResult.relatedBooks.map(r => `
                                <article class="gtutor__related-card" data-work="${r.workN}">
                                    <span class="gtutor__related-n">#${r.workN}</span>
                                    <h5 class="gtutor__related-title">${esc(r.title)}</h5>
                                    <div class="gtutor__related-shared">
                                        ${r.sharedConcepts.map(c => `<span class="gtutor__t">${esc(c)}</span>`).join('')}
                                    </div>
                                    <button class="gtutor__btn gtutor__btn--sm" data-action="open-work" data-work="${r.workN}">Ver obra</button>
                                </article>
                            `).join('')}
                        </div>
                    ` : ''}

                    ${searchResult.termExperts && Object.keys(searchResult.termExperts).length ? `
                        <h4 class="gtutor__section-h">🎓 Libros expertos en tus términos</h4>
                        <div class="gtutor__experts">
                            ${Object.entries(searchResult.termExperts).map(([term, experts]) => `
                                <div class="gtutor__expert-row">
                                    <span class="gtutor__expert-term">${esc(term)}</span>
                                    <span class="gtutor__expert-list">${experts.map(e => `<button class="gtutor__expert-book" data-action="open-work" data-work="${e.workN}">#${e.workN} · ${esc(e.title)}</button>`).join('')}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                ` : ''}
            </div>
        `;
    }

    let reflectQuery = '';
    let reflectQueryResult = null;

    // ═════════════════════════════════════════════
    // v36 · REPASO ESPACIADO
    // ═════════════════════════════════════════════
    let repasoCard = null;       // tarjeta en pantalla
    let repasoRevealed = false;  // ¿ya mostró la respuesta?
    let repasoQueue = [];

    function _repasoBadge() {
        const st = window.GunterRepaso?.stats?.();
        return st?.due ? ` <span class="gtutor__tab-badge">${st.due}</span>` : '';
    }

    function _viewRepaso() {
        const R = window.GunterRepaso;
        if (!R) return _error('Servicio de repaso no cargado. Recargá.');
        const st = R.stats();

        // Sesión activa: mostrar la tarjeta actual
        if (repasoCard) {
            return `
                <div class="gtutor__repaso">
                    <div class="gtutor__repaso-meta">
                        <span class="gtutor__chip">Quedan ${repasoQueue.length + 1} por repasar</span>
                        <span class="gtutor__chip">${repasoCard.type === 'bookmark' ? '★ pasaje' : '💡 concepto'} ${repasoCard.workN ? '· #' + repasoCard.workN : ''}</span>
                        <button class="gtutor__btn gtutor__btn--sm" data-action="repaso-exit">Salir</button>
                    </div>
                    <article class="gtutor__repaso-card ${repasoRevealed ? 'is-revealed' : ''}">
                        <div class="gtutor__repaso-front">
                            <div class="gtutor__eyebrow">Pregunta</div>
                            <p>${esc(repasoCard.front)}</p>
                        </div>
                        ${repasoRevealed ? `
                            <div class="gtutor__repaso-back">
                                <div class="gtutor__eyebrow">Respuesta</div>
                                <p>${esc(repasoCard.back)}</p>
                            </div>
                        ` : ''}
                    </article>
                    ${!repasoRevealed ? `
                        <div class="gtutor__repaso-actions">
                            <button class="gtutor__btn gtutor__btn--primary" data-action="repaso-reveal">Mostrar respuesta</button>
                        </div>
                    ` : `
                        <div class="gtutor__repaso-actions gtutor__repaso-grades">
                            <button class="gtutor__btn gtutor__grade--again" data-action="repaso-grade" data-q="0">Otra vez<small>10 min</small></button>
                            <button class="gtutor__btn gtutor__grade--hard"  data-action="repaso-grade" data-q="3">Difícil<small>~${_previewInterval(repasoCard, 3)}</small></button>
                            <button class="gtutor__btn gtutor__grade--good"  data-action="repaso-grade" data-q="4">Bien<small>~${_previewInterval(repasoCard, 4)}</small></button>
                            <button class="gtutor__btn gtutor__grade--easy"  data-action="repaso-grade" data-q="5">Fácil<small>~${_previewInterval(repasoCard, 5)}</small></button>
                        </div>
                        <div class="gtutor__repaso-help">
                            <button class="gtutor__btn gtutor__btn--sm" data-action="repaso-ask">💬 Pedirle al sabio que lo explique</button>
                        </div>
                    `}
                </div>
            `;
        }

        // Vista de inicio del repaso
        return `
            <div class="gtutor__repaso">
                <div class="gtutor__reflect-stats" style="margin-bottom:16px">
                    <div class="gtutor__reflect-stat">
                        <div class="gtutor__reflect-stat-num">${st.due}</div>
                        <div class="gtutor__reflect-stat-label">para hoy</div>
                    </div>
                    <div class="gtutor__reflect-stat">
                        <div class="gtutor__reflect-stat-num">${st.total}</div>
                        <div class="gtutor__reflect-stat-label">tarjetas</div>
                    </div>
                    <div class="gtutor__reflect-stat">
                        <div class="gtutor__reflect-stat-num">${st.mature}</div>
                        <div class="gtutor__reflect-stat-label">maduras (≥21d)</div>
                    </div>
                    <div class="gtutor__reflect-stat">
                        <div class="gtutor__reflect-stat-num">${st.accuracy !== null ? st.accuracy + '%' : '—'}</div>
                        <div class="gtutor__reflect-stat-label">precisión</div>
                    </div>
                </div>
                <p class="gtutor__hint">El repaso espaciado convierte tus <strong>marcadores y conceptos explorados</strong> en tarjetas con intervalos crecientes (1d → 3d → 7d → …). Contestás de memoria, te calificás con honestidad, y Gunter programa el siguiente repaso. Sin repaso, olvidás ~80% en una semana. Con esto, no.</p>
                <div class="gtutor__repaso-actions">
                    ${st.due > 0 ? `<button class="gtutor__btn gtutor__btn--primary" data-action="repaso-start">▶ Repasar ${st.due} tarjeta${st.due === 1 ? '' : 's'}</button>` : '<span class="gtutor__hint">✅ Nada pendiente por hoy.</span>'}
                    <button class="gtutor__btn" data-action="repaso-generate">🔄 Generar tarjetas desde mi huella</button>
                </div>
                ${st.total === 0 ? '<p class="gtutor__hint" style="margin-top:12px">Todavía no hay tarjetas: marcá pasajes con ★ o clickeá conceptos, y después tocá "Generar tarjetas".</p>' : ''}
            </div>
        `;
    }

    function _previewInterval(card, quality) {
        // Preview aproximado del próximo intervalo
        let reps = card.reps, interval = card.interval, ease = card.ease;
        reps++;
        if (reps === 1) interval = 1;
        else if (reps === 2) interval = 3;
        else interval = Math.round(interval * ease);
        if (quality === 3) interval = Math.max(1, Math.round(interval * 0.7));
        if (quality === 5) interval = Math.round(interval * 1.3);
        return interval + 'd';
    }

    async function repasoGenerate() {
        const res = await window.GunterRepaso.generateCards();
        window.GunterCompanion?.say?.(res.created > 0
            ? `🔁 Generé ${res.created} tarjeta${res.created === 1 ? '' : 's'} nueva${res.created === 1 ? '' : 's'} desde tu huella. Total: ${res.total}.`
            : 'No hay material nuevo para tarjetas. Marcá pasajes con ★ o explorá conceptos primero.');
        render();
    }

    function repasoStart() {
        repasoQueue = window.GunterRepaso.getDue(50);
        repasoCard = repasoQueue.shift() || null;
        repasoRevealed = false;
        render();
    }

    function repasoGrade(quality) {
        if (!repasoCard) return;
        window.GunterRepaso.answer(repasoCard.id, Number(quality));
        repasoCard = repasoQueue.shift() || null;
        repasoRevealed = false;
        if (!repasoCard) {
            const st = window.GunterRepaso.stats();
            window.GunterCompanion?.say?.(`🔁 Sesión de repaso terminada. Precisión histórica: ${st.accuracy ?? '—'}%. ${st.accuracy >= 80 ? 'Nada mal para un humano.' : 'Ya mejorará. O no. Veremos.'}`);
            try { window.dispatchEvent(new CustomEvent('gunter-repaso-done')); } catch {}
        }
        render();
    }

    // ═════════════════════════════════════════════
    // v36 · TRIVIA DEL SABIO
    // ═════════════════════════════════════════════
    let trivia = null;   // { mode, question, options, answerIdx, score, streak, round, done }

    function _triviaHighScore() {
        try { return Number(localStorage.getItem('gunter_trivia_high') || 0); } catch { return 0; }
    }
    function _setTriviaHigh(v) {
        try { localStorage.setItem('gunter_trivia_high', String(v)); } catch {}
    }

    function _viewTrivia() {
        const digests = [];
        // Usa el warm cache — cero requests
        const inv = window.GunterTutor?.warmedGet ? null : null;
        for (const w of (cat.works || [])) {
            const d = window.GunterTutor?.warmedGet?.('digest', w.n);
            if (d?.signature_passages?.length) digests.push(d);
        }

        if (digests.length < 4) {
            return `
                <div class="gtutor__empty">
                    <p>La trivia necesita el cache del sabio. Esperá unos segundos a que caliente (o activá modo tutor) y reintentá.</p>
                    <button class="gtutor__btn gtutor__btn--primary" data-view-jump="trivia">Reintentar</button>
                </div>`;
        }

        // Hub de juegos: 20 Preguntas activo tiene prioridad de render
        if (veinte) return _view20Q();

        if (!trivia) {
            return `
                <div class="gtutor__trivia">
                    <div class="gtutor__trivia-hero">
                        <h2 class="gtutor__study-title">🎮 Trivia del Sabio</h2>
                        <p class="gtutor__hint">10 rondas. Dos tipos de desafío: <strong>¿de qué libro es esta cita?</strong> y <strong>encontrá el concepto intruso</strong>. Racha = multiplicador. Gunter comenta tu desempeño con su tacto habitual.</p>
                        <div class="gtutor__trivia-high">🏆 Récord: <strong>${_triviaHighScore()}</strong> puntos</div>
                        <button class="gtutor__btn gtutor__btn--primary" data-action="trivia-start">▶ Jugar</button>
                    </div>
                    <div class="gtutor__trivia-hero" style="padding:24px">
                        <h3 class="gtutor__cur-title">🔮 20 Preguntas</h3>
                        <p class="gtutor__hint">Gunter piensa un concepto de los libros. Vos preguntás cosas de sí/no hasta adivinarlo (o quedarte sin preguntas). Él responde con su conocimiento real del corpus — sin trampa.</p>
                        <button class="gtutor__btn gtutor__btn--primary" data-action="veinte-start">▶ Jugar 20 Preguntas</button>
                    </div>
                </div>`;
        }

        if (trivia.done) {
            const isRecord = trivia.score > _triviaHighScore();
            if (isRecord) {
                _setTriviaHigh(trivia.score);
                try { window.dispatchEvent(new CustomEvent('gunter-trivia-record')); } catch {}
            }
            const burla = trivia.score >= 800 ? 'Impresionante. Casi como si hubieras leído los libros.'
                : trivia.score >= 400 ? 'Decente. Grinberg estaría... conforme.'
                : 'Bueno. Los libros siguen ahí, esperándote.';
            return `
                <div class="gtutor__trivia">
                    <div class="gtutor__trivia-hero">
                        <h2 class="gtutor__study-title">${isRecord ? '🏆 ¡Nuevo récord!' : 'Fin del juego'}</h2>
                        <div class="gtutor__trivia-score-big">${trivia.score} pts</div>
                        <p class="gtutor__hint">${trivia.hits}/10 correctas · racha máxima ${trivia.maxStreak} · ${esc(burla)}</p>
                        <button class="gtutor__btn gtutor__btn--primary" data-action="trivia-start">↻ Otra ronda</button>
                    </div>
                </div>`;
        }

        const q = trivia.question;
        return `
            <div class="gtutor__trivia">
                <div class="gtutor__trivia-status">
                    <span class="gtutor__chip">Ronda ${trivia.round}/10</span>
                    <span class="gtutor__chip">⭐ ${trivia.score} pts</span>
                    <span class="gtutor__chip ${trivia.streak >= 3 ? 'gtutor__chip--accent' : ''}">🔥 racha ${trivia.streak}</span>
                </div>
                <article class="gtutor__trivia-q">
                    <div class="gtutor__eyebrow">${q.mode === 'quote' ? '¿De qué libro es esta cita?' : `3 de estos conceptos dominan en "${esc(q.bookTitle)}" — ¿cuál es el INTRUSO?`}</div>
                    ${q.mode === 'quote' ? `<blockquote class="gtutor__study-quote">"${esc(q.passage)}"</blockquote>` : ''}
                    <div class="gtutor__trivia-options">
                        ${q.options.map((opt, i) => `
                            <button class="gtutor__trivia-opt ${trivia.answered !== null ? (i === q.answerIdx ? 'is-correct' : (i === trivia.answered ? 'is-wrong' : 'is-disabled')) : ''}"
                                    data-action="trivia-answer" data-idx="${i}" ${trivia.answered !== null ? 'disabled' : ''}>
                                ${esc(opt)}
                            </button>
                        `).join('')}
                    </div>
                    ${trivia.answered !== null ? `
                        <div class="gtutor__trivia-feedback ${trivia.answered === q.answerIdx ? 'is-ok' : 'is-bad'}">
                            ${trivia.answered === q.answerIdx
                                ? `✅ +${trivia.lastPoints} pts ${trivia.streak >= 3 ? '(racha ×' + (1 + trivia.streak * 0.1).toFixed(1) + ')' : ''}`
                                : `❌ Era: ${esc(q.options[q.answerIdx])}`}
                            <button class="gtutor__btn gtutor__btn--primary gtutor__btn--sm" data-action="trivia-next">${trivia.round >= 10 ? 'Ver resultado' : 'Siguiente →'}</button>
                        </div>
                    ` : ''}
                </article>
            </div>
        `;
    }

    // ═════════════════════════════════════════════
    // v38 · 20 PREGUNTAS DEL CORPUS
    // Gunter piensa un concepto (keyConcepts del catálogo).
    // El usuario pregunta sí/no; el LLM responde con el
    // contexto secreto. Adivinar = match fuzzy local.
    // ═════════════════════════════════════════════
    let veinte = null;   // { secret, workN, workTitle, context, qa: [{q,a}], remaining, done, won, busy }

    async function veinteStart() {
        // Elegir obra + concepto legible del catálogo curado
        const withConcepts = (cat.works || []).filter(w => (w.keyConcepts || []).length >= 2);
        if (!withConcepts.length) {
            window.GunterCompanion?.say?.('No tengo conceptos curados para jugar. Raro.');
            return;
        }
        const w = withConcepts[Math.floor(Math.random() * withConcepts.length)];
        const secret = w.keyConcepts[Math.floor(Math.random() * w.keyConcepts.length)];

        veinte = { secret, workN: w.n, workTitle: w.title, context: '', qa: [], remaining: 20, done: false, won: false, busy: false };
        render();

        // Contexto para que el LLM responda con conocimiento real (async, no bloquea)
        try {
            const res = await window.GunterTutor?.sageBm25?.(secret, { limit: 2 });
            veinte.context = (res?.hits || []).map(h => h.snippet).join(' … ').slice(0, 900);
        } catch {}
    }

    function _view20Q() {
        const v = veinte;
        if (v.done) {
            return `
                <div class="gtutor__trivia">
                    <div class="gtutor__trivia-hero">
                        <h2 class="gtutor__study-title">${v.won ? '🎉 ¡Adivinaste!' : '🔮 Fin del juego'}</h2>
                        <p class="gtutor__hint">El concepto era: <strong>"${esc(v.secret)}"</strong> — de #${v.workN} "${esc(v.workTitle)}".</p>
                        <p class="gtutor__hint">${v.won ? `Lo sacaste con ${20 - v.remaining} pregunta${20 - v.remaining === 1 ? '' : 's'}. ${20 - v.remaining <= 8 ? 'Eficiencia sospechosa.' : 'Por el camino largo, pero llegaste.'}` : 'Las 20 preguntas no alcanzaron. El corpus sigue invicto.'}</p>
                        <div class="gtutor__repaso-actions">
                            <button class="gtutor__btn gtutor__btn--primary" data-action="veinte-start">↻ Otra ronda</button>
                            <button class="gtutor__btn" data-action="veinte-learn">📖 Que Gunter me explique el concepto</button>
                            <button class="gtutor__btn" data-action="veinte-exit">Salir</button>
                        </div>
                    </div>
                </div>`;
        }
        return `
            <div class="gtutor__trivia">
                <div class="gtutor__trivia-status">
                    <span class="gtutor__chip">🔮 20 Preguntas</span>
                    <span class="gtutor__chip ${v.remaining <= 5 ? 'gtutor__chip--accent' : ''}">${v.remaining} restantes</span>
                    <button class="gtutor__btn gtutor__btn--sm" data-action="veinte-exit">Rendirse</button>
                </div>
                <article class="gtutor__trivia-q">
                    <div class="gtutor__eyebrow">Pensé un concepto de los libros de Grinberg. Preguntá cosas de SÍ o NO.</div>
                    ${v.qa.length ? `
                        <div class="gtutor__veinte-log">
                            ${v.qa.map((x, i) => `
                                <div class="gtutor__veinte-row">
                                    <span class="gtutor__veinte-n">${i + 1}</span>
                                    <span class="gtutor__veinte-q">${esc(x.q)}</span>
                                    <span class="gtutor__veinte-a gtutor__veinte-a--${x.a === 'Sí' ? 'yes' : x.a === 'No' ? 'no' : 'meh'}">${esc(x.a)}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<p class="gtutor__hint">Ejemplos: "¿Es una práctica?", "¿Tiene que ver con el cerebro?", "¿Aparece en los libros de chamanes?"</p>'}
                    <form class="gtutor__search-form" data-action="veinte-ask">
                        <input type="text" class="gtutor__search-input" placeholder="${v.busy ? 'Gunter está pensando…' : 'Tu pregunta de sí/no…'}" ${v.busy ? 'disabled' : ''}>
                        <button type="submit" class="gtutor__btn gtutor__btn--primary" ${v.busy ? 'disabled' : ''}>Preguntar</button>
                    </form>
                    <form class="gtutor__search-form" data-action="veinte-guess">
                        <input type="text" class="gtutor__search-input" placeholder="¿Ya sabés? Escribí el concepto…" ${v.busy ? 'disabled' : ''}>
                        <button type="submit" class="gtutor__btn" ${v.busy ? 'disabled' : ''}>🎯 Adivinar</button>
                    </form>
                </article>
            </div>`;
    }

    async function veinteAsk(question) {
        const v = veinte;
        if (!v || v.done || v.busy || !question.trim()) return;
        v.busy = true;
        render();
        let answer = 'No sé';
        try {
            const prompt = `Juego de 20 preguntas. El CONCEPTO SECRETO es: "${v.secret}" (de la obra "${v.workTitle}" de Grinberg).
Contexto real del concepto: ${v.context || '(sin contexto extra)'}

El jugador pregunta: "${question.trim()}"

Respondé ÚNICAMENTE con una de estas palabras: "Sí" · "No" · "Parcialmente" · "Irrelevante".
Sé honesto según el concepto y su contexto. NO reveles el concepto. NO agregues nada más.`;
            const raw = await window.GunterNlpLlm?.complete?.(prompt, { temperature: 0.1, maxTokens: 10, skipMemory: true });
            const clean = String(raw || '').trim().toLowerCase();
            answer = clean.startsWith('sí') || clean.startsWith('si') ? 'Sí'
                   : clean.startsWith('no') ? 'No'
                   : clean.startsWith('parcial') ? 'Parcialmente'
                   : 'Irrelevante';
        } catch { answer = '⚠ sin conexión'; }
        v.qa.push({ q: question.trim(), a: answer });
        v.remaining--;
        v.busy = false;
        if (v.remaining <= 0) { v.done = true; v.won = false; }
        render();
    }

    function veinteGuess(guess) {
        const v = veinte;
        if (!v || v.done || !guess.trim()) return;
        const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, '').trim();
        const g = norm(guess), s = norm(v.secret);
        // Match: igual, contenido, o >70% de palabras compartidas
        const gWords = new Set(g.split(/\s+/)), sWords = s.split(/\s+/);
        const shared = sWords.filter(w => gWords.has(w)).length;
        const won = g === s || g.includes(s) || s.includes(g) || (sWords.length > 0 && shared / sWords.length >= 0.7);
        v.done = true;
        v.won = won;
        render();
    }

    function triviaStart() {
        trivia = { score: 0, streak: 0, maxStreak: 0, round: 0, hits: 0, done: false, answered: null, question: null, lastPoints: 0 };
        triviaNext();
    }

    function triviaNext() {
        if (trivia.round >= 10) { trivia.done = true; render(); return; }
        trivia.round++;
        trivia.answered = null;

        // Libros con material en el warm cache
        const books = [];
        for (const w of (cat.works || [])) {
            const d = window.GunterTutor?.warmedGet?.('digest', w.n);
            const c = window.GunterTutor?.warmedGet?.('concepts', w.n);
            if (d?.signature_passages?.length && c?.topConcepts?.length >= 4) books.push({ w, d, c });
        }
        const pick = arr => arr[Math.floor(Math.random() * arr.length)];
        const shuffle = arr => arr.slice().sort(() => Math.random() - 0.5);

        const mode = Math.random() < 0.6 ? 'quote' : 'intruder';
        if (mode === 'quote') {
            const chosen = shuffle(books).slice(0, 4);
            const answer = pick(chosen);
            const passage = pick(answer.d.signature_passages);
            const options = shuffle(chosen.map(b => b.d.title));
            trivia.question = {
                mode: 'quote',
                passage: passage.text.slice(0, 280) + (passage.text.length > 280 ? '…' : ''),
                options,
                answerIdx: options.indexOf(answer.d.title)
            };
        } else {
            const two = shuffle(books).slice(0, 2);
            const home = two[0], intruderBook = two[1];
            const homeCs = shuffle(home.c.topConcepts.slice(0, 12)).slice(0, 3).map(x => x.term);
            const intruderC = pick(intruderBook.c.topConcepts.slice(0, 8)).term;
            const options = shuffle([...homeCs, intruderC]);
            trivia.question = {
                mode: 'intruder',
                bookTitle: home.d.title,
                options,
                answerIdx: options.indexOf(intruderC)
            };
        }
        render();
    }

    function triviaAnswer(idx) {
        if (trivia.answered !== null) return;
        trivia.answered = Number(idx);
        if (trivia.answered === trivia.question.answerIdx) {
            trivia.streak++;
            trivia.maxStreak = Math.max(trivia.maxStreak, trivia.streak);
            trivia.hits++;
            const mult = 1 + trivia.streak * 0.1;
            trivia.lastPoints = Math.round(100 * mult);
            trivia.score += trivia.lastPoints;
        } else {
            trivia.streak = 0;
        }
        render();
    }

    function _viewReflect() {
        const notes = window.GunterTutorNotes;
        if (!notes) return _error('Servicio de notas no cargado. Recargá la página.');

        const st = notes.stats();
        if (st.notesCount === 0 && st.bookmarksCount === 0 && st.historyCount === 0) {
            return `
                <div class="gtutor__empty">
                    <p>Todavía no tenés notas ni marcadores.</p>
                    <p class="gtutor__hint">Abrí cualquier obra, marcá pasajes con ★ o escribí notas. Acá se refleja tu huella completa.</p>
                    <button class="gtutor__btn gtutor__btn--primary" data-view-jump="library">Ver biblioteca</button>
                </div>
            `;
        }

        const heatmap = notes.activityHeatmap(30);
        const contribution = notes.bookContribution().slice(0, 10);
        const cloud = notes.conceptCloud();
        const allBookmarks = notes.listBookmarks();
        const allNotes = notes.listNotes();
        const maxHeat = Math.max(1, ...heatmap.map(h => h.count));

        return `
            <div class="gtutor__reflect">
                <header class="gtutor__reflect-head">
                    <div class="gtutor__reflect-stats">
                        <div class="gtutor__reflect-stat">
                            <div class="gtutor__reflect-stat-num">${st.notesCount}</div>
                            <div class="gtutor__reflect-stat-label">notas</div>
                        </div>
                        <div class="gtutor__reflect-stat">
                            <div class="gtutor__reflect-stat-num">${st.bookmarksCount}</div>
                            <div class="gtutor__reflect-stat-label">marcadores</div>
                        </div>
                        <div class="gtutor__reflect-stat">
                            <div class="gtutor__reflect-stat-num">${st.worksTouched}</div>
                            <div class="gtutor__reflect-stat-label">obras tocadas</div>
                        </div>
                        <div class="gtutor__reflect-stat">
                            <div class="gtutor__reflect-stat-num">${st.historyCount}</div>
                            <div class="gtutor__reflect-stat-label">acciones</div>
                        </div>
                    </div>
                </header>

                <section class="gtutor__reflect-section">
                    <h4 class="gtutor__section-h">🔥 Últimos 30 días de actividad</h4>
                    <div class="gtutor__heatmap">
                        ${heatmap.map(h => {
                            const intensity = h.count === 0 ? 0 : Math.min(4, Math.ceil((h.count / maxHeat) * 4));
                            const d = new Date(h.date);
                            const label = d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' });
                            return `<div class="gtutor__heat-cell" data-intensity="${intensity}" title="${label}: ${h.count} acciones"></div>`;
                        }).join('')}
                    </div>
                    <div class="gtutor__heat-legend">
                        <span>menos</span>
                        <span class="gtutor__heat-cell" data-intensity="0"></span>
                        <span class="gtutor__heat-cell" data-intensity="1"></span>
                        <span class="gtutor__heat-cell" data-intensity="2"></span>
                        <span class="gtutor__heat-cell" data-intensity="3"></span>
                        <span class="gtutor__heat-cell" data-intensity="4"></span>
                        <span>más</span>
                    </div>
                </section>

                <section class="gtutor__reflect-section">
                    <h4 class="gtutor__section-h">📚 Obras en las que dejaste más huella</h4>
                    <div class="gtutor__contrib-list">
                        ${contribution.map((c, i) => {
                            const w = cat.works.find(x => x.n === c.workN);
                            const barW = Math.min(100, (c.total / contribution[0].total) * 100);
                            return `
                                <div class="gtutor__contrib-row">
                                    <span class="gtutor__contrib-rank">${i + 1}</span>
                                    <button class="gtutor__contrib-title" data-action="open-work" data-work="${c.workN}">
                                        #${c.workN} · ${esc(w?.title || 'Obra')}
                                    </button>
                                    <div class="gtutor__contrib-bar">
                                        <div class="gtutor__contrib-fill" style="width:${barW}%"></div>
                                    </div>
                                    <div class="gtutor__contrib-meta">
                                        ${c.notes > 0 ? `<span title="Notas">✎ ${c.notes}</span>` : ''}
                                        ${c.bookmarks > 0 ? `<span title="Marcadores">★ ${c.bookmarks}</span>` : ''}
                                        ${c.actions > 0 ? `<span title="Acciones">◦ ${c.actions}</span>` : ''}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </section>

                ${cloud.length ? `
                    <section class="gtutor__reflect-section">
                        <h4 class="gtutor__section-h">💭 Palabras que aparecen en tus notas</h4>
                        <div class="gtutor__reflect-cloud">
                            ${cloud.map(c => {
                                const size = Math.min(24, 11 + c.count * 2);
                                return `<button class="gtutor__cloud-term" data-action="ask-term" data-term="${esc(c.term)}" style="font-size:${size}px" title="${c.count} apariciones">${esc(c.term)}</button>`;
                            }).join('')}
                        </div>
                    </section>
                ` : ''}

                <section class="gtutor__reflect-section">
                    <h4 class="gtutor__section-h">🔎 Buscar en tus notas</h4>
                    <form class="gtutor__search-form" data-action="reflect-search">
                        <input type="text" class="gtutor__search-input"
                               placeholder="¿Qué escribiste sobre…?"
                               value="${esc(reflectQuery)}">
                        <button type="submit" class="gtutor__btn gtutor__btn--primary">Buscar</button>
                    </form>
                    ${reflectQueryResult && reflectQueryResult.hits.length ? `
                        <div class="gtutor__reflect-hits">
                            ${reflectQueryResult.hits.map(h => {
                                const w = cat.works.find(x => x.n === h.workN);
                                const cap = h.chapterIdx !== null && h.chapterIdx !== undefined ? ` · cap ${h.chapterIdx}` : '';
                                return `
                                    <article class="gtutor__reflect-hit">
                                        <header>
                                            <button class="gtutor__reflect-hit-work" data-action="open-work" data-work="${h.workN}">#${h.workN} ${esc(w?.title || '')}${cap}</button>
                                            <span class="gtutor__hit-score">match ${h.score}</span>
                                        </header>
                                        <p>${esc(h.text)}</p>
                                        <div class="gtutor__reflect-hit-meta">${new Date(h.updatedAt || h.at).toLocaleString('es-MX')}</div>
                                    </article>
                                `;
                            }).join('')}
                        </div>
                        <div class="gtutor__synth-cta" style="margin-top:12px">
                            <button class="gtutor__btn gtutor__btn--primary" data-action="reflect-synth" data-query="${esc(reflectQuery)}">
                                🎓 Que Gunter sintetice lo que escribí sobre esto
                            </button>
                        </div>
                    ` : reflectQueryResult ? `<p class="gtutor__hint">Sin coincidencias en tus notas.</p>` : ''}
                </section>

                ${allBookmarks.length ? `
                    <section class="gtutor__reflect-section">
                        <h4 class="gtutor__section-h">✦ Catálogo completo de marcadores (${allBookmarks.length})</h4>
                        <div class="gtutor__reflect-bookmarks">
                            ${allBookmarks.map(b => {
                                const w = cat.works.find(x => x.n === b.workN);
                                return `
                                    <article class="gtutor__reflect-bookmark">
                                        <button class="gtutor__bookmark-star is-active" data-action="remove-bookmark" data-id="${b.id}" title="Quitar">★</button>
                                        <div>
                                            <button class="gtutor__reflect-hit-work" data-action="open-work" data-work="${b.workN}">#${b.workN} · p.${b.pageStart}${b.pageEnd !== b.pageStart ? '–'+b.pageEnd : ''}</button>
                                            <div class="gtutor__reflect-hit-meta">${esc(w?.title || '')}</div>
                                        </div>
                                        ${b.snippet ? `<p class="gtutor__bookmark-snip">"${esc(b.snippet.slice(0, 200))}${b.snippet.length > 200 ? '…' : ''}"</p>` : ''}
                                    </article>
                                `;
                            }).join('')}
                        </div>
                    </section>
                ` : ''}

                <section class="gtutor__reflect-section gtutor__reflect-danger">
                    <h4 class="gtutor__section-h">💾 Exportar / limpiar</h4>
                    <div class="gtutor__reflect-actions">
                        <button class="gtutor__btn gtutor__btn--sm" data-action="reflect-export">📤 Exportar todo (JSON)</button>
                        <button class="gtutor__btn gtutor__btn--sm gtutor__btn--danger" data-action="reflect-clear">🗑️ Borrar toda mi huella</button>
                    </div>
                </section>
            </div>
        `;
    }

    function _viewSynth() {
        const suggestions = [
            'meditación y campo unificado',
            'yo, ego y disolución del sujeto',
            'chamanismo y neurofisiología',
            'realidad, percepción y conciencia',
            'espacio, tiempo y sintergia'
        ];
        return `
            <div class="gtutor__synth">
                <p class="gtutor__hint">
                    Preguntá algo transversal. El sabio busca en los ${sageStatus?.chunks || '—'} pasajes con BM25 <strong>+ expansión de términos</strong>,
                    después agrupa por libro y te muestra <strong>quién contribuye cuánto</strong> a la respuesta.
                </p>
                <form class="gtutor__search-form" data-action="synth-submit">
                    <input type="text" class="gtutor__search-input"
                           placeholder="Ej. '¿cómo se conecta meditación con el campo unificado?'"
                           value="${esc(synthQuery)}">
                    <button type="submit" class="gtutor__btn gtutor__btn--primary">Sintetizar</button>
                </form>
                ${!synthResult ? `
                    <div class="gtutor__search-empty">
                        <div class="gtutor__suggest">
                            <span class="gtutor__hint">Probá:</span>
                            ${suggestions.map(s => `<button class="gtutor__suggest-btn" data-synth-suggest="${esc(s)}">${esc(s)}</button>`).join('')}
                        </div>
                    </div>
                ` : ''}

                ${synthResult && !synthResult.contributingBooks?.length ? `
                    <p class="gtutor__hint">Sin resultados — reformulá con otros términos.</p>
                ` : ''}

                ${synthResult?.contributingBooks?.length ? `
                    <div class="gtutor__synth-meta">
                        <span class="gtutor__chip">🔍 ${synthResult.totalHits} pasajes encontrados</span>
                        <span class="gtutor__chip">📚 ${synthResult.contributingBooks.length} libros contribuyen</span>
                        ${synthResult.expansionTerms?.length ? `<span class="gtutor__chip gtutor__chip--sage">➕ Expandí con: ${synthResult.expansionTerms.join(', ')}</span>` : ''}
                    </div>

                    <h4 class="gtutor__section-h">📊 Matriz de contribuciones por obra</h4>
                    <div class="gtutor__synth-matrix">
                        ${synthResult.contributingBooks.map((b, idx) => {
                            const barWidth = Math.min(100, (b.totalScore / synthResult.contributingBooks[0].totalScore) * 100);
                            return `
                                <article class="gtutor__synth-book">
                                    <header class="gtutor__synth-book-head">
                                        <span class="gtutor__synth-rank">${idx + 1}</span>
                                        <div>
                                            <button class="gtutor__synth-book-title" data-action="open-work" data-work="${b.workN}">
                                                #${b.workN} · ${esc(b.workTitle)}
                                            </button>
                                            <div class="gtutor__synth-book-meta">
                                                <span>${b.passageCount} pasajes</span>
                                                <span>·</span>
                                                <span>pp. ${b.topPages.slice(0, 4).join(', ')}${b.topPages.length > 4 ? '…' : ''}</span>
                                                <span>·</span>
                                                <span>score máx ${b.topScore}</span>
                                            </div>
                                        </div>
                                        <span class="gtutor__synth-score">${b.totalScore.toFixed(1)}</span>
                                    </header>
                                    <div class="gtutor__synth-bar">
                                        <div class="gtutor__synth-bar-fill" style="width:${barWidth}%"></div>
                                    </div>
                                    <details class="gtutor__synth-passages">
                                        <summary>Ver ${b.topPassages.length} pasajes signature</summary>
                                        <div class="gtutor__sig-list">
                                            ${b.topPassages.map(p => `
                                                <article class="gtutor__sig-card">
                                                    <header>
                                                        <span class="gtutor__toc-page">p.${p.pageStart}</span>
                                                        <span class="gtutor__hit-score">score ${p.score}</span>
                                                        <button class="gtutor__narrate-btn" data-action="narrate-passage" data-text="${esc(p.snippet)}" title="Leer">🔊</button>
                                                    </header>
                                                    <p>${highlight(p.snippet, [...(synthResult.queryTokens||[]), ...(synthResult.expansionTerms||[])])}</p>
                                                </article>
                                            `).join('')}
                                        </div>
                                    </details>
                                </article>
                            `;
                        }).join('')}
                    </div>

                    <div class="gtutor__synth-cta">
                        <button class="gtutor__btn gtutor__btn--primary" data-action="synth-explain" data-query="${esc(synthQuery)}">
                            🎓 Que Gunter sintetice hilando todas las obras
                        </button>
                        <span class="gtutor__hint">Gunter recibe la matriz completa como contexto y responde citando cada obra por su contribución. Sin invento.</span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    function _viewConcepts() {
        // Aglomerar conceptos de todos los libros indexados
        // No los tenemos precargados — sync-lazy load todos al abrir vista
        // Por ahora mostramos "loader" y disparamos load, o mostramos si ya está en cache
        const loadedBooks = Object.keys(workConceptsCache);
        const indexed = (cat.works || []).filter(w => w.hasFile);

        if (loadedBooks.length === 0) {
            // Trigger lazy load
            setTimeout(async () => {
                for (const w of indexed.slice(0, 33)) {
                    if (!workConceptsCache[w.n]) {
                        const c = await window.GunterTutor.sageConcepts?.(w.n).catch(() => null);
                        if (c) workConceptsCache[w.n] = c;
                    }
                }
                if (activeView === 'concepts') render();
            }, 50);
            return '<div class="gtutor__empty"><p>Cargando conceptos clave de cada obra…</p></div>';
        }

        // Ranking global de conceptos: cuentos libros los tratan (breadth)
        const globalTerms = new Map();  // term → { count, books: Set }
        for (const [workN, meta] of Object.entries(workConceptsCache)) {
            for (const c of (meta.topConcepts || []).slice(0, 15)) {
                const g = globalTerms.get(c.term) || { term: c.term, count: 0, books: new Set(), maxTfidf: 0 };
                g.count++;
                g.books.add(workN);
                if (c.tfidf > g.maxTfidf) g.maxTfidf = c.tfidf;
                globalTerms.set(c.term, g);
            }
        }
        const universal = Array.from(globalTerms.values())
            .filter(g => g.count >= 3)
            .sort((a, b) => b.count - a.count)
            .slice(0, 30);
        const unique = Array.from(globalTerms.values())
            .filter(g => g.count === 1)
            .sort((a, b) => b.maxTfidf - a.maxTfidf)
            .slice(0, 20);

        return `
            <div class="gtutor__concepts">
                <p class="gtutor__hint">Los conceptos que se detectaron como característicos de cada obra vía TF-IDF sobre <strong>${sageStatus?.chunks || '—'}</strong> pasajes. Hacé clic en cualquier término para preguntarle al sabio de qué se trata.</p>

                <h4 class="gtutor__section-h">🌐 Universales — tratados en múltiples obras</h4>
                <div class="gtutor__concept-cloud">
                    ${universal.map(g => `
                        <button class="gtutor__concept-chip gtutor__concept-chip--universal"
                                data-action="ask-term" data-term="${esc(g.term)}"
                                title="Aparece en ${g.count} obras: ${Array.from(g.books).map(b => '#'+b).join(', ')}">
                            <span>${esc(g.term)}</span>
                            <span class="gtutor__concept-count">${g.count}</span>
                        </button>
                    `).join('')}
                </div>

                <h4 class="gtutor__section-h">💎 Únicos — específicos de una obra</h4>
                <div class="gtutor__concept-cloud">
                    ${unique.map(g => {
                        const book = Array.from(g.books)[0];
                        return `<button class="gtutor__concept-chip"
                                        data-action="ask-term" data-term="${esc(g.term)}"
                                        title="Aparece principalmente en #${book}">
                            <span>${esc(g.term)}</span>
                            <span class="gtutor__concept-count">#${book}</span>
                        </button>`;
                    }).join('')}
                </div>

                <h4 class="gtutor__section-h">📖 Por obra</h4>
                <div class="gtutor__concept-books">
                    ${Object.entries(workConceptsCache).sort((a, b) => Number(a[0]) - Number(b[0])).map(([n, meta]) => `
                        <article class="gtutor__concept-book">
                            <header>
                                <span class="gtutor__card-n">#${n}</span>
                                <h5>${esc(meta.title)}</h5>
                            </header>
                            <div class="gtutor__concept-list">
                                ${(meta.topConcepts || []).slice(0, 10).map(c => `
                                    <button class="gtutor__t gtutor__t--btn" data-action="ask-term" data-term="${esc(c.term)}">${esc(c.term)}</button>
                                `).join('')}
                            </div>
                        </article>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function _tocItem(workN, h) {
        const hasAnalysis = (h.chunkCount || 0) > 0;
        const idx = h.chapterIdx ?? 0;
        return `
            <details class="gtutor__toc-item" data-chapter-idx="${idx}">
                <summary class="gtutor__toc-summary">
                    <span class="gtutor__toc-idx">${String(idx + 1).padStart(2, '0')}</span>
                    <span class="gtutor__toc-page">p.${h.pageStart}${h.pageEnd && h.pageEnd !== h.pageStart ? '–'+h.pageEnd : ''}</span>
                    <span class="gtutor__toc-title">${esc(h.label)}</span>
                    ${hasAnalysis ? `<span class="gtutor__toc-meta">${h.readingTimeMin}m · ${h.chunkCount} pasajes</span>` : ''}
                </summary>
                <div class="gtutor__toc-body">
                    ${h.concepts?.length ? `
                        <div class="gtutor__toc-concepts">
                            <span class="gtutor__eyebrow">Conceptos del capítulo</span>
                            ${h.concepts.slice(0, 6).map(c => `<button class="gtutor__t gtutor__t--btn" data-action="ask-term" data-term="${esc(c.term)}">${esc(c.term)}</button>`).join('')}
                        </div>
                    ` : ''}
                    ${h.signaturePassage ? `
                        <div class="gtutor__toc-sig">
                            <span class="gtutor__eyebrow">Fragmento signature (p.${h.signaturePassage.pageStart})</span>
                            <blockquote>${esc(h.signaturePassage.text)}</blockquote>
                        </div>
                    ` : ''}
                    <div class="gtutor__toc-actions">
                        ${hasAnalysis ? `<button class="gtutor__btn gtutor__btn--primary gtutor__btn--sm" data-action="explore-chapter" data-work="${workN}" data-chapter-idx="${idx}">💬 Hablar de esta sección con el sabio</button>` : '<span class="gtutor__hint">Sin análisis (rango sin chunks indexados)</span>'}
                    </div>
                </div>
            </details>
        `;
    }

    function _renderDigestSection(n) {
        const dig = workDigestCache[n];
        if (dig === undefined) {
            // Trigger lazy load
            setTimeout(async () => {
                const d = await window.GunterTutor.sageDigest?.(n).catch(() => null);
                workDigestCache[n] = d || null;
                if (selectedWorkN === n) render();
            }, 40);
            return `<section class="gtutor__detail-section"><p class="gtutor__hint">Cargando vista general…</p></section>`;
        }
        if (dig === null) {
            return `<section class="gtutor__detail-section"><p class="gtutor__hint">Sin digest disponible para esta obra.</p></section>`;
        }

        // Segmentar el TOC visible: primeros 12, resto colapsable
        const toc = dig.toc || [];
        const tocHead = toc.slice(0, 12);
        const tocTail = toc.slice(12);

        return `
            <section class="gtutor__detail-section gtutor__digest">
                <h4 class="gtutor__section-h">📄 Vista general del libro</h4>
                <div class="gtutor__digest-stats">
                    <span class="gtutor__chip">⏱️ ${dig.stats.readingTimeMin} min de lectura</span>
                    <span class="gtutor__chip">📖 ${dig.stats.wordCount.toLocaleString()} palabras</span>
                    <span class="gtutor__chip">📃 ${dig.stats.textPages} páginas</span>
                    <span class="gtutor__chip">🧠 ${dig.stats.chunks} pasajes indexados</span>
                </div>

                ${dig.opening ? `
                    <div class="gtutor__digest-opening">
                        <div class="gtutor__eyebrow">Fragmento de apertura</div>
                        <blockquote>${esc(dig.opening)}</blockquote>
                    </div>
                ` : ''}

                ${toc.length ? `
                    <div class="gtutor__digest-toc">
                        <h5 class="gtutor__digest-h5">Estructura detectada (${toc.length} secciones) — click en cualquiera para explorarla con el sabio</h5>
                        <div class="gtutor__toc-list">
                            ${tocHead.map(h => _tocItem(n, h)).join('')}
                        </div>
                        ${tocTail.length ? `
                            <details class="gtutor__toc-more">
                                <summary>Ver ${tocTail.length} secciones más</summary>
                                <div class="gtutor__toc-list">
                                    ${tocTail.map(h => _tocItem(n, h)).join('')}
                                </div>
                            </details>
                        ` : ''}
                    </div>
                ` : ''}

                ${dig.signature_passages?.length ? `
                    <div class="gtutor__digest-signatures">
                        <h5 class="gtutor__digest-h5">✨ Pasajes signature (los más representativos según BM25)</h5>
                        <div class="gtutor__sig-list">
                            ${dig.signature_passages.map(p => {
                                const bookmarked = window.GunterTutorNotes?.hasBookmark?.(n, p.pageStart);
                                return `
                                <article class="gtutor__sig-card">
                                    <header>
                                        <span class="gtutor__toc-page">p.${p.pageStart}${p.pageEnd !== p.pageStart ? '–'+p.pageEnd : ''}</span>
                                        <span class="gtutor__hit-score">score ${p.score}</span>
                                        <button class="gtutor__narrate-btn" title="Leer en voz alta" data-action="narrate-passage" data-text="${esc(p.text)}">🔊</button>
                                        <button class="gtutor__bookmark-btn ${bookmarked ? 'is-active' : ''}" title="${bookmarked ? 'Quitar marcador' : 'Marcar este pasaje'}" data-action="toggle-bookmark" data-work="${n}" data-page-start="${p.pageStart}" data-page-end="${p.pageEnd}" data-snippet="${esc(p.text.slice(0, 200))}">
                                            ${bookmarked ? '★' : '☆'}
                                        </button>
                                    </header>
                                    <p>${esc(p.text)}</p>
                                    <button class="gtutor__btn gtutor__btn--sm" data-action="explain-here" data-work="${n}" data-page="${p.pageStart}">Explícamelo</button>
                                </article>
                            `;}).join('')}
                        </div>
                    </div>
                ` : ''}

                ${_renderNotesArea(n)}
            </section>
        `;
    }

    function _renderNotesArea(workN) {
        const notes = window.GunterTutorNotes?.listNotes?.({ workN }) || [];
        const bookmarks = window.GunterTutorNotes?.listBookmarks?.({ workN }) || [];
        return `
            <div class="gtutor__notes-area">
                <h5 class="gtutor__digest-h5">📝 Tus notas y marcadores en esta obra</h5>

                ${bookmarks.length ? `
                    <div class="gtutor__bookmarks-list">
                        <div class="gtutor__eyebrow">${bookmarks.length} marcador${bookmarks.length === 1 ? '' : 'es'}</div>
                        ${bookmarks.slice(0, 8).map(b => `
                            <div class="gtutor__bookmark-item">
                                <span class="gtutor__bookmark-star">★</span>
                                <span class="gtutor__toc-page">p.${b.pageStart}${b.pageEnd !== b.pageStart ? '–'+b.pageEnd : ''}</span>
                                ${b.snippet ? `<span class="gtutor__bookmark-snip">${esc(b.snippet.slice(0, 100))}${b.snippet.length > 100 ? '…' : ''}</span>` : ''}
                                <button class="gtutor__bookmark-btn is-active" data-action="remove-bookmark" data-id="${b.id}" title="Quitar">×</button>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                <div class="gtutor__notes-editor">
                    <div class="gtutor__eyebrow">Nota general de la obra</div>
                    <textarea class="gtutor__notes-textarea" data-note-work="${workN}"
                              placeholder="Anotá tus reflexiones, dudas, conexiones… (se guarda solo mientras escribís)"
                              rows="4">${esc(notes.find(n => n.chapterIdx === null || n.chapterIdx === undefined)?.text || '')}</textarea>
                    <div class="gtutor__notes-hint">Guardado automático · las notas se inyectan al contexto de Gunter para que las tenga en cuenta al hablarte de esta obra.</div>
                </div>
            </div>
        `;
    }

    // ═════════════════════════════════════════════
    // v28 · STUDY SESSION FLOW
    // Gunter camina el libro con vos, capítulo por capítulo.
    // Fases: intro → chapters → wrap-up
    // ═════════════════════════════════════════════
    function _viewStudySession() {
        const s = studySession;
        if (!s) return _error('No hay sesión de estudio activa.');
        const dig = s.digest;
        const chapters = (dig?.toc || []).filter(ch => (ch.chunkCount || 0) > 0);
        const totalSteps = chapters.length + 2;   // intro + capítulos + wrap-up

        // 0 = intro, 1..N = chapters, N+1 = wrap-up
        const idx = s.stepIdx;
        const isIntro = idx === 0;
        const isWrap  = idx === totalSteps - 1;
        const chapter = !isIntro && !isWrap ? chapters[idx - 1] : null;

        return `
            <div class="gtutor__study">
                <header class="gtutor__study-head">
                    <button class="gtutor__btn" data-action="study-exit">← Salir de la sesión</button>
                    <div class="gtutor__study-progress">
                        <div class="gtutor__study-bar">
                            <div class="gtutor__study-fill" style="width:${((idx+1)/totalSteps*100).toFixed(1)}%"></div>
                        </div>
                        <span class="gtutor__study-count">Paso ${idx+1} de ${totalSteps}</span>
                    </div>
                </header>

                <article class="gtutor__study-card">
                    ${isIntro ? _studyIntro(dig) : ''}
                    ${chapter ? _studyChapter(s.workN, chapter, idx) : ''}
                    ${isWrap ? _studyWrap(dig) : ''}
                </article>

                <footer class="gtutor__study-nav">
                    <button class="gtutor__btn" data-action="study-prev" ${idx === 0 ? 'disabled' : ''}>← Anterior</button>
                    <button class="gtutor__btn gtutor__btn--primary" data-action="study-ask">
                        💬 Pregunta a Gunter sobre este paso
                    </button>
                    <button class="gtutor__btn gtutor__btn--primary" data-action="study-next" ${isWrap ? 'disabled' : ''}>
                        ${chapter ? 'Siguiente capítulo →' : 'Continuar →'}
                    </button>
                </footer>
            </div>
        `;
    }

    function _studyIntro(dig) {
        return `
            <div class="gtutor__eyebrow">Bienvenida al libro</div>
            <h2 class="gtutor__study-title">${esc(dig.title)}</h2>
            <div class="gtutor__digest-stats" style="margin:12px 0 20px">
                <span class="gtutor__chip">⏱️ ${dig.stats.readingTimeMin} min de lectura completa</span>
                <span class="gtutor__chip">📖 ${dig.stats.wordCount.toLocaleString()} palabras</span>
                <span class="gtutor__chip">🗂️ ${(dig.toc||[]).filter(t => t.chunkCount).length} capítulos indexados</span>
            </div>
            ${dig.opening ? `
                <div class="gtutor__study-opening">
                    <div class="gtutor__eyebrow">Así empieza el libro</div>
                    <blockquote>${esc(dig.opening)}</blockquote>
                </div>
            ` : ''}
            <div class="gtutor__study-hint">
                <p>Vas a atravesar el libro conmigo, capítulo por capítulo. En cada uno te muestro:</p>
                <ul>
                    <li>Los conceptos clave del capítulo</li>
                    <li>El pasaje signature (el más denso semánticamente)</li>
                    <li>La opción de conversar en profundidad si te interesa</li>
                </ul>
                <p>Al final, un resumen que hilamos juntos. Cuando estés listo, dale <em>Continuar</em>.</p>
            </div>
        `;
    }

    function _studyChapter(workN, ch, stepIdx) {
        return `
            <div class="gtutor__eyebrow">Capítulo · Paso ${stepIdx}</div>
            <h2 class="gtutor__study-title">${esc(ch.label)}</h2>
            <div class="gtutor__digest-stats" style="margin:10px 0 16px">
                <span class="gtutor__chip">p.${ch.pageStart}${ch.pageEnd && ch.pageEnd !== ch.pageStart ? '–'+ch.pageEnd : ''}</span>
                <span class="gtutor__chip">${ch.readingTimeMin || '?'} min</span>
                <span class="gtutor__chip">${ch.chunkCount || 0} pasajes indexados</span>
            </div>
            ${ch.concepts?.length ? `
                <div class="gtutor__study-section">
                    <div class="gtutor__eyebrow">Ideas centrales de este capítulo</div>
                    <div class="gtutor__concept-list" style="margin-top:8px">
                        ${ch.concepts.slice(0, 8).map(c => `<button class="gtutor__t gtutor__t--btn" data-action="ask-term" data-term="${esc(c.term)}">${esc(c.term)}</button>`).join('')}
                    </div>
                </div>
            ` : ''}
            ${ch.signaturePassage ? `
                <div class="gtutor__study-section">
                    <div class="gtutor__eyebrow">Pasaje signature (p.${ch.signaturePassage.pageStart})</div>
                    <blockquote class="gtutor__study-quote">${esc(ch.signaturePassage.text)}</blockquote>
                </div>
            ` : ''}
            <div class="gtutor__study-cta">
                <button class="gtutor__btn gtutor__btn--primary" data-action="study-deep" data-work="${workN}" data-chapter-idx="${ch.chapterIdx}">
                    📖 Explorar este capítulo en profundidad
                </button>
                <span class="gtutor__hint">(Abre el chat con el capítulo completo cargado como contexto para que Gunter lo explique)</span>
            </div>
        `;
    }

    function _studyWrap(dig) {
        const bigConcepts = (dig.concept_summary || []).slice(0, 8);
        return `
            <div class="gtutor__eyebrow">Cierre de la sesión</div>
            <h2 class="gtutor__study-title">Recorrimos ${esc(dig.title)}</h2>
            <div class="gtutor__study-section">
                <div class="gtutor__eyebrow">Conceptos que emergieron a lo largo del libro</div>
                <div class="gtutor__concept-list" style="margin-top:10px">
                    ${bigConcepts.map(c => `<button class="gtutor__t gtutor__t--btn" data-action="ask-term" data-term="${esc(c.term)}">${esc(c.term)}</button>`).join('')}
                </div>
            </div>
            ${dig.closing ? `
                <div class="gtutor__study-section">
                    <div class="gtutor__eyebrow">Así cierra el libro</div>
                    <blockquote class="gtutor__study-quote">${esc(dig.closing)}</blockquote>
                </div>
            ` : ''}
            <div class="gtutor__study-cta">
                <button class="gtutor__btn gtutor__btn--primary" data-action="study-summary" data-work="${studySession.workN}">
                    🎓 Que Gunter te haga un resumen final oral
                </button>
                <button class="gtutor__btn" data-action="study-quiz" data-work="${studySession.workN}">
                    🧠 Hacer un mini-quiz de comprensión
                </button>
            </div>
            <div class="gtutor__study-hint">
                <p>Cuando quieras, salí de la sesión con el botón de arriba. El progreso ya quedó guardado en <em>Mi progreso</em>.</p>
            </div>
        `;
    }

    async function startStudy(workN) {
        const dig = workDigestCache[workN] || await window.GunterTutor.sageDigest?.(workN).catch(() => null);
        if (!dig) {
            _talkToTutor(`No pude cargar el digest de la obra #${workN}. Chequeá los logs.`);
            return;
        }
        workDigestCache[workN] = dig;
        const chapters = (dig.toc || []).filter(ch => (ch.chunkCount || 0) > 0);
        studySession = { workN, digest: dig, stepIdx: 0, totalSteps: chapters.length + 2, phase: 'intro' };
        activeView = 'study';
        selectedWorkN = null;
        try {
            await window.GunterTutor.progress({ workN, note: `Sesión guiada arrancada (${chapters.length + 2} pasos)` });
        } catch {}
        render();
    }

    function studyNext() {
        if (!studySession) return;
        studySession.stepIdx = Math.min(studySession.totalSteps - 1, studySession.stepIdx + 1);
        render();
    }
    function studyPrev() {
        if (!studySession) return;
        studySession.stepIdx = Math.max(0, studySession.stepIdx - 1);
        render();
    }
    function studyExit() {
        studySession = null;
        activeView = 'session';
        render();
    }

    async function studyAsk() {
        if (!studySession) return;
        const s = studySession;
        const dig = s.digest;
        const isIntro = s.stepIdx === 0;
        const isWrap  = s.stepIdx === s.totalSteps - 1;
        const chapters = (dig.toc || []).filter(ch => (ch.chunkCount || 0) > 0);
        const ch = !isIntro && !isWrap ? chapters[s.stepIdx - 1] : null;

        if (isIntro) {
            _talkToTutor(`Estoy arrancando la lectura guiada de "${dig.title}". Dame un contexto de qué esperar del libro en 3 líneas y con qué concepto central abre.`);
        } else if (isWrap) {
            _talkToTutor(`Terminé de recorrer "${dig.title}" en modo guiado. Hazme un cierre sintético: 3 aprendizajes centrales, 1 tensión no resuelta, y qué obra leería a continuación para profundizar.`);
        } else if (ch) {
            // Set chapter focus para RAG rico
            try {
                const chapterFull = await window.GunterTutor.sageChapter?.(s.workN, ch.chapterIdx);
                if (chapterFull) window.GunterTutor.setChapterFocus?.(chapterFull);
            } catch {}
            _talkToTutor(`Estamos en la sesión guiada de "${dig.title}", capítulo "${ch.label}". Explícame en 4-5 frases qué desarrolla y en qué conecta con los capítulos anteriores.`);
        }
    }

    async function studyDeep(workN, chapterIdx) {
        // Delegado al mismo flow del detalle: seteamos foco de capítulo y arrancamos convo
        return exploreChapter(workN, chapterIdx);
    }

    async function studySummary(workN) {
        const dig = studySession?.digest || workDigestCache[workN];
        if (!dig) return;
        // Limpiamos chapter focus (queremos resumen amplio, no de un capítulo)
        window.GunterTutor.clearChapterFocus?.();
        _talkToTutor(`Terminé la lectura guiada de "${dig.title}". Hazme un resumen oral de 90 segundos: tesis central, arco del libro, y 2 preguntas que este texto deja abiertas. Estilo tutor: claro, con pausas, con humor seco puntual.`);
    }

    async function studyQuiz(workN) {
        const dig = studySession?.digest || workDigestCache[workN];
        if (!dig) return;
        window.GunterTutor.clearChapterFocus?.();
        _talkToTutor(`Terminé la lectura guiada de "${dig.title}". Hazme un quiz de 3 preguntas de comprensión progresiva (fácil, media, difícil) SOBRE ESTA obra. Preguntas una a la vez, esperá mi respuesta, dame feedback antes de la siguiente. Sin adular, sin regalar la respuesta.`);
    }

    function _viewWorkDetail(n) {
        const w = cat.works.find(x => x.n === n);
        if (!w) return _error(`Obra #${n} no encontrada.`);
        const cachedConcepts = workConceptsCache[n];
        // Lazy load si no está
        if (!cachedConcepts && w.hasFile) {
            setTimeout(async () => {
                const c = await window.GunterTutor.sageConcepts?.(n).catch(() => null);
                if (c) { workConceptsCache[n] = c; render(); }
            }, 50);
        }
        const done = sess?.chapters?.[n]?.length || 0;
        const diff = { principiante: 'gtutor__diff--easy', intermedio: 'gtutor__diff--mid', avanzado: 'gtutor__diff--hard' }[w.difficulty] || '';

        return `
            <div class="gtutor__detail">
                <button class="gtutor__btn gtutor__back" data-action="back-to-list">← Volver a la biblioteca</button>

                <header class="gtutor__detail-head">
                    <span class="gtutor__card-n">#${w.n}</span>
                    <div>
                        <h2 class="gtutor__detail-title">${esc(w.title)}</h2>
                        <div class="gtutor__detail-meta">
                            <span class="gtutor__diff ${diff}">${w.difficulty}</span>
                            ${(w.themes||[]).map(t => `<span class="gtutor__t">${esc(t)}</span>`).join('')}
                            ${!w.hasFile ? '<span class="gtutor__flag-nofile" style="position:static">⚠ escaneado (sin texto extraído)</span>' : ''}
                            ${done > 0 ? `<span class="gtutor__chip gtutor__chip--accent">${done} capítulos vistos</span>` : ''}
                        </div>
                    </div>
                </header>

                ${w.prerequisites?.length ? `
                    <section class="gtutor__detail-section">
                        <h4 class="gtutor__section-h">📚 Prerrequisitos sugeridos</h4>
                        <div class="gtutor__related">
                            ${w.prerequisites.map(pn => {
                                const p = cat.works.find(x => x.n === pn);
                                return p ? `<button class="gtutor__related-card gtutor__related-card--small" data-action="open-work" data-work="${p.n}">
                                    <span class="gtutor__related-n">#${p.n}</span>
                                    <h5>${esc(p.title)}</h5>
                                </button>` : '';
                            }).join('')}
                        </div>
                    </section>
                ` : ''}

                ${_renderDigestSection(n)}

                <section class="gtutor__detail-section">
                    <h4 class="gtutor__section-h">💡 Conceptos característicos (TF-IDF)</h4>
                    ${cachedConcepts ? `
                        <div class="gtutor__concept-list">
                            ${(cachedConcepts.topConcepts || []).slice(0, 20).map(c => `
                                <button class="gtutor__t gtutor__t--btn" data-action="ask-term" data-term="${esc(c.term)}" title="TF-IDF ${c.tfidf.toFixed(4)}, ${c.count} apariciones">${esc(c.term)}</button>
                            `).join('')}
                        </div>
                        <p class="gtutor__hint">${cachedConcepts.chunks} pasajes semánticos indexados de esta obra.</p>
                    ` : (w.hasFile ? '<p class="gtutor__hint">Cargando…</p>' : '<p class="gtutor__hint">No indexado (PDF escaneado).</p>')}
                </section>

                <section class="gtutor__detail-section">
                    <h4 class="gtutor__section-h">🔗 Obras relacionadas (cross-refs)</h4>
                    <div id="gtutor-crossrefs-${n}" class="gtutor__related"><p class="gtutor__hint">Cargando…</p></div>
                </section>

                <section class="gtutor__detail-actions">
                    ${w.hasFile && cachedConcepts ? `<button class="gtutor__btn gtutor__btn--primary" data-action="study" data-work="${n}">📚 Sesión guiada capítulo por capítulo</button>` : ''}
                    <button class="gtutor__btn" data-action="start" data-work="${n}">Marcar como en curso</button>
                    <button class="gtutor__btn" data-action="ask" data-work="${n}">Preguntarle al sabio sobre #${n}</button>
                </section>
            </div>
        `;
    }

    function _viewSession() {
        if (!sess?.currentWork) {
            return `
                <div class="gtutor__empty">
                    <p>Aún no arrancaste ninguna obra. Elegí una desde la Biblioteca o una Ruta de estudio.</p>
                    <button class="gtutor__btn gtutor__btn--primary" data-view-jump="library">Ver biblioteca</button>
                </div>
            `;
        }
        const w = cat.works.find(x => x.n === sess.currentWork);
        const done = sess.chapters?.[sess.currentWork] || [];
        return `
            <div class="gtutor__session">
                <div class="gtutor__session-head">
                    <div>
                        <div class="gtutor__eyebrow">EN CURSO</div>
                        <h3 class="gtutor__session-title">#${w?.n} · ${esc(w?.title || '—')}</h3>
                    </div>
                    <button class="gtutor__btn" data-action="ask" data-work="${sess.currentWork}">Continuar con Gunter</button>
                </div>
                <div class="gtutor__session-body">
                    <p class="gtutor__hint">Capítulos vistos: <strong>${done.length}</strong></p>
                    ${done.length ? `<ul class="gtutor__session-log">${done.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : '<p class="gtutor__hint">Todavía sin capítulos registrados.</p>'}
                </div>
                <div class="gtutor__session-history">
                    <h4>Historial (últimas 8 acciones)</h4>
                    <ul>${(sess.history || []).slice(-8).reverse().map(h => `<li>${new Date(h.at).toLocaleString()} — ${esc(h.note || (h.chapter ? 'capítulo: '+h.chapter : 'progreso'))}</li>`).join('')}</ul>
                </div>
            </div>
        `;
    }

    function wire() {
        host.querySelectorAll('[data-view]').forEach(b => {
            if (b.tagName === 'BUTTON') {
                b.addEventListener('click', () => {
                    activeView = b.dataset.view;
                    selectedWorkN = null;
                    render();
                });
            }
        });
        host.querySelectorAll('[data-view-jump]').forEach(b => {
            b.addEventListener('click', () => {
                activeView = b.dataset.viewJump;
                selectedWorkN = null;
                render();
            });
        });
        host.querySelectorAll('[data-action="start"]').forEach(b => {
            b.addEventListener('click', () => startWork(b.dataset.work));
        });
        host.querySelectorAll('[data-action="ask"]').forEach(b => {
            b.addEventListener('click', () => askAboutWork(b.dataset.work));
        });
        host.querySelectorAll('[data-action="ask-term"]').forEach(b => {
            b.addEventListener('click', () => askAboutTerm(b.dataset.term));
        });
        host.querySelectorAll('[data-action="start-curriculum"]').forEach(b => {
            b.addEventListener('click', () => startCurriculum(b.dataset.cur));
        });
        host.querySelectorAll('[data-action="explain-here"]').forEach(b => {
            b.addEventListener('click', () => askAboutWork(b.dataset.work, b.dataset.page));
        });
        host.querySelectorAll('[data-action="open-work"]').forEach(b => {
            b.addEventListener('click', () => { selectedWorkN = b.dataset.work; render(); });
        });
        host.querySelectorAll('[data-action="back-to-list"]').forEach(b => {
            b.addEventListener('click', () => { selectedWorkN = null; render(); });
        });
        host.querySelectorAll('[data-suggest]').forEach(b => {
            b.addEventListener('click', () => {
                searchQuery = b.dataset.suggest;
                _runSearch();
            });
        });
        host.querySelectorAll('[data-synth-suggest]').forEach(b => {
            b.addEventListener('click', () => {
                synthQuery = b.dataset.synthSuggest;
                _runSynth();
            });
        });
        const synthForm = host.querySelector('[data-action="synth-submit"]');
        if (synthForm) {
            synthForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const input = synthForm.querySelector('input');
                synthQuery = input.value.trim();
                if (synthQuery.length < 4) return;
                await _runSynth();
            });
        }
        host.querySelectorAll('[data-action="synth-explain"]').forEach(b => {
            b.addEventListener('click', () => synthExplain(b.dataset.query));
        });
        // Reflect
        const reflectForm = host.querySelector('[data-action="reflect-search"]');
        if (reflectForm) {
            reflectForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const input = reflectForm.querySelector('input');
                reflectQuery = input.value.trim();
                if (!reflectQuery) return;
                reflectQueryResult = window.GunterTutorNotes?.queryNotes?.(reflectQuery) || { hits: [] };
                render();
            });
        }
        host.querySelectorAll('[data-action="reflect-synth"]').forEach(b => {
            b.addEventListener('click', () => reflectSynth(b.dataset.query));
        });
        host.querySelectorAll('[data-action="reflect-export"]').forEach(b => {
            b.addEventListener('click', reflectExport);
        });
        host.querySelectorAll('[data-action="reflect-clear"]').forEach(b => {
            b.addEventListener('click', reflectClear);
        });
        // Narrate passages 🔊
        host.querySelectorAll('[data-action="narrate-passage"]').forEach(b => {
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                speakPassage(b.dataset.text || '', b);
            });
        });
        // Repaso espaciado
        host.querySelectorAll('[data-action="repaso-generate"]').forEach(b => b.addEventListener('click', repasoGenerate));
        host.querySelectorAll('[data-action="repaso-start"]').forEach(b => b.addEventListener('click', repasoStart));
        host.querySelectorAll('[data-action="repaso-reveal"]').forEach(b => b.addEventListener('click', () => { repasoRevealed = true; render(); }));
        host.querySelectorAll('[data-action="repaso-grade"]').forEach(b => b.addEventListener('click', () => repasoGrade(b.dataset.q)));
        host.querySelectorAll('[data-action="repaso-exit"]').forEach(b => b.addEventListener('click', () => { repasoCard = null; repasoQueue = []; render(); }));
        host.querySelectorAll('[data-action="repaso-ask"]').forEach(b => b.addEventListener('click', () => {
            if (repasoCard) _talkToTutor(`Estoy repasando esta tarjeta: "${repasoCard.front}". Explicámela bien, con la fuente.`);
        }));
        // Trivia
        host.querySelectorAll('[data-action="trivia-start"]').forEach(b => b.addEventListener('click', () => { veinte = null; triviaStart(); }));
        host.querySelectorAll('[data-action="trivia-answer"]').forEach(b => b.addEventListener('click', () => triviaAnswer(b.dataset.idx)));
        host.querySelectorAll('[data-action="trivia-next"]').forEach(b => b.addEventListener('click', triviaNext));
        // 20 Preguntas
        host.querySelectorAll('[data-action="veinte-start"]').forEach(b => b.addEventListener('click', () => { trivia = null; veinteStart(); }));
        host.querySelectorAll('[data-action="veinte-exit"]').forEach(b => b.addEventListener('click', () => {
            if (veinte && !veinte.done) { veinte.done = true; veinte.won = false; render(); }
            else { veinte = null; render(); }
        }));
        host.querySelectorAll('[data-action="veinte-learn"]').forEach(b => b.addEventListener('click', () => {
            if (veinte) _talkToTutor(`Explícame el concepto "${veinte.secret}" de la obra #${veinte.workN} "${veinte.workTitle}". Con cita si hay pasaje.`);
        }));
        const veinteAskForm = host.querySelector('[data-action="veinte-ask"]');
        if (veinteAskForm) {
            veinteAskForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const input = veinteAskForm.querySelector('input');
                veinteAsk(input.value);
                input.value = '';
            });
        }
        const veinteGuessForm = host.querySelector('[data-action="veinte-guess"]');
        if (veinteGuessForm) {
            veinteGuessForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const input = veinteGuessForm.querySelector('input');
                veinteGuess(input.value);
            });
        }
        host.querySelectorAll('[data-action="explore-chapter"]').forEach(b => {
            b.addEventListener('click', () => exploreChapter(b.dataset.work, b.dataset.chapterIdx));
        });
        // Bookmarks
        host.querySelectorAll('[data-action="toggle-bookmark"]').forEach(b => {
            b.addEventListener('click', () => toggleBookmark(b));
        });
        host.querySelectorAll('[data-action="remove-bookmark"]').forEach(b => {
            b.addEventListener('click', () => {
                window.GunterTutorNotes?.removeBookmark?.(b.dataset.id);
                render();
            });
        });
        // Notas — auto-save con debounce
        host.querySelectorAll('[data-note-work]').forEach(t => {
            let timer = null;
            t.addEventListener('input', () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    window.GunterTutorNotes?.upsertNote?.({
                        workN: t.dataset.noteWork,
                        chapterIdx: null,
                        text: t.value
                    });
                    // Micro feedback: borde primario 400ms
                    t.classList.add('is-saved');
                    setTimeout(() => t.classList.remove('is-saved'), 600);
                }, 600);
            });
        });
        // Study session handlers
        host.querySelectorAll('[data-action="study"]').forEach(b => {
            b.addEventListener('click', () => startStudy(b.dataset.work));
        });
        host.querySelectorAll('[data-action="study-next"]').forEach(b => {
            b.addEventListener('click', studyNext);
        });
        host.querySelectorAll('[data-action="study-prev"]').forEach(b => {
            b.addEventListener('click', studyPrev);
        });
        host.querySelectorAll('[data-action="study-exit"]').forEach(b => {
            b.addEventListener('click', studyExit);
        });
        host.querySelectorAll('[data-action="study-ask"]').forEach(b => {
            b.addEventListener('click', studyAsk);
        });
        host.querySelectorAll('[data-action="study-deep"]').forEach(b => {
            b.addEventListener('click', () => studyDeep(b.dataset.work, b.dataset.chapterIdx));
        });
        host.querySelectorAll('[data-action="study-summary"]').forEach(b => {
            b.addEventListener('click', () => studySummary(b.dataset.work));
        });
        host.querySelectorAll('[data-action="study-quiz"]').forEach(b => {
            b.addEventListener('click', () => studyQuiz(b.dataset.work));
        });
        const form = host.querySelector('[data-action="search-submit"]');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const input = form.querySelector('input');
                searchQuery = input.value.trim();
                if (searchQuery.length < 3) return;
                await _runSearch();
            });
        }

        // Lazy-load cross-refs para el detalle
        if (selectedWorkN) {
            const holder = host.querySelector(`#gtutor-crossrefs-${selectedWorkN}`);
            if (holder) {
                window.GunterTutor.sageCrossRefs?.(selectedWorkN).then(res => {
                    if (!res?.refs?.length) {
                        holder.innerHTML = '<p class="gtutor__hint">Sin cross-refs (obra muy única).</p>';
                        return;
                    }
                    holder.innerHTML = res.refs.slice(0, 6).map(r => `
                        <button class="gtutor__related-card gtutor__related-card--small" data-action="open-work-x" data-work="${r.workN}">
                            <span class="gtutor__related-n">#${r.workN}</span>
                            <h5>${esc(r.title)}</h5>
                            <div class="gtutor__related-shared">${(r.shared||[]).slice(0, 4).map(t => `<span class="gtutor__t">${esc(t)}</span>`).join('')}</div>
                        </button>
                    `).join('');
                    holder.querySelectorAll('[data-action="open-work-x"]').forEach(b => {
                        b.addEventListener('click', () => { selectedWorkN = b.dataset.work; render(); });
                    });
                }).catch(() => {});
            }
        }
    }

    async function _runSearch() {
        if (!window.GunterTutor.sageQuery) return;
        const res = await window.GunterTutor.sageQuery(searchQuery, { limit: 6 });
        searchResult = res?.ok ? res : { queryTokens: [], primaryHits: [], relatedBooks: [], termExperts: {} };
        window.GunterTutorNotes?.log?.({ kind: 'query', query: searchQuery, hits: (searchResult.primaryHits || []).length });
        render();
    }

    async function _runSynth() {
        if (!window.GunterTutor.sageSynthesize) return;
        const res = await window.GunterTutor.sageSynthesize(synthQuery, { limit: 12 });
        synthResult = res?.ok ? res : { contributingBooks: [], expansionTerms: [], totalHits: 0 };
        window.GunterTutorNotes?.log?.({ kind: 'synth', query: synthQuery, hits: synthResult.totalHits || 0 });
        render();
    }

    async function reflectSynth(query) {
        if (!query) return;
        const notesRes = window.GunterTutorNotes?.queryNotes?.(query);
        if (!notesRes?.hits?.length) {
            _talkToTutor(`Buscá en mis notas sobre "${query}". Encontraste ${notesRes?.hits?.length || 0} — decime honestamente que no tengo nada escrito sobre eso, y sugerí qué libro de la biblioteca podría cubrirlo.`);
            return;
        }
        const bookMap = new Map();
        for (const h of notesRes.hits.slice(0, 10)) {
            const list = bookMap.get(h.workN) || [];
            list.push(h);
            bookMap.set(h.workN, list);
        }
        const summary = Array.from(bookMap.entries())
            .map(([wn, hits]) => `#${wn}: ${hits.length} notas`)
            .join(', ');
        _talkToTutor(`Sintetizá lo que YO escribí sobre "${query}" en mis notas personales (${notesRes.hits.length} coincidencias, distribuidas en: ${summary}). Los pasajes están en el bloque "TU HUELLA DE ESTUDIO". Hilá lo que escribí en distintas obras: qué patrón se repite, dónde hay tensión, qué idea me quedé anotando desde distintos ángulos. Máx 120 palabras. No inventes: solo hablá de lo que aparece literal en mis notas.`);
    }

    function reflectExport() {
        const data = window.GunterTutorNotes?.exportAll?.();
        if (!data) return;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gunter-tutor-notes-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
    }

    function reflectClear() {
        if (!confirm('¿Borrar todas tus notas, marcadores e historial? Esto no se puede deshacer.')) return;
        window.GunterTutorNotes?.clearAll?.();
        reflectQuery = '';
        reflectQueryResult = null;
        render();
    }

    function toggleBookmark(btn) {
        const workN = btn.dataset.work;
        const pageStart = Number(btn.dataset.pageStart);
        const pageEnd = Number(btn.dataset.pageEnd || pageStart);
        const snippet = btn.dataset.snippet || '';
        if (window.GunterTutorNotes.hasBookmark(workN, pageStart)) {
            const existing = window.GunterTutorNotes.listBookmarks({ workN })
                .find(b => b.pageStart === pageStart);
            if (existing) window.GunterTutorNotes.removeBookmark(existing.id);
        } else {
            window.GunterTutorNotes.addBookmark({ workN, pageStart, pageEnd, snippet });
            window.GunterTutorNotes.log({ kind: 'bookmark', workN, page: pageStart });
        }
        render();
    }

    async function synthExplain(query) {
        if (!synthResult) return;
        const topBooks = synthResult.contributingBooks.slice(0, 5);
        const booksLine = topBooks.map(b => `#${b.workN} (${b.passageCount} pasajes, pp.${b.topPages.slice(0,3).join(',')})`).join(', ');
        _talkToTutor(`Síntesis cruzada sobre: "${query}". El sabio ya encontró ${synthResult.totalHits} pasajes en ${synthResult.contributingBooks.length} libros. Los 5 que más aportan: ${booksLine}. Hilá las obras: primero la tesis central, después 2-3 conexiones concretas entre los libros con cita textual de al menos 2 fuentes distintas. Si algún libro contribuye pero el pasaje no respalda una idea clara, decilo con honestidad y no lo fuerces.`);
    }

    async function askAboutTerm(term) {
        if (!term) return;
        window.GunterTutorNotes?.log?.({ kind: 'ask-term', term });
        _talkToTutor(`Explícame qué es "${term}" en la obra de Grinberg. Cita las obras que más lo tratan.`);
    }

    async function exploreChapter(workN, chapterIdx) {
        // Trae el capítulo del server + setea foco en tutor-service
        const chapter = await window.GunterTutor.sageChapter?.(workN, Number(chapterIdx));
        if (!chapter) {
            _talkToTutor(`No pude cargar el capítulo #${chapterIdx} de la obra #${workN}. Chequeá los logs.`);
            return;
        }
        window.GunterTutor.setChapterFocus?.(chapter);
        window.GunterTutorNotes?.log?.({ kind: 'explore-chapter', workN, chapterIdx: Number(chapterIdx), page: chapter.pageStart });
        // Auto progress: registrar que se abrió ese capítulo
        try {
            await window.GunterTutor.progress({
                workN,
                chapter: `cap-${chapterIdx}`,
                note: `Explorando: ${chapter.label}`
            });
        } catch {}
        _talkToTutor(`Explícame el capítulo "${chapter.label}" de la obra #${workN}. Empezá con la tesis central y luego pasá por los conceptos clave.`);
    }

    async function startWork(n) {
        await window.GunterTutor.progress({ workN: n, note: 'iniciado desde panel' });
        await refresh();
        // Auto-open companion with a starter question
        _talkToTutor(`Empecé la obra #${n}. Dame el resumen de qué voy a leer y por dónde arrancar.`);
    }

    async function startCurriculum(id) {
        const cur = cat.curricula.find(c => c.id === id);
        if (!cur || !cur.path?.length) return;
        const firstN = cur.path[0];
        await window.GunterTutor.progress({ workN: firstN, note: `curriculum: ${id}` });
        await refresh();
        _talkToTutor(`Arranco la ruta "${cur.label}". Guíame por la primera obra.`);
    }

    async function askAboutWork(n, page = null) {
        const w = cat.works.find(x => x.n === n);
        const q = page
            ? `Explícame lo que dice #${n} "${w?.title}" en la página ${page}.`
            : `Cuéntame de qué trata #${n} "${w?.title}" y por dónde debería empezar.`;
        _talkToTutor(q);
    }

    function _talkToTutor(text) {
        // Abre el companion y le envía el mensaje
        try {
            if (window.GunterCompanion?.__handleFromWake) {
                window.GunterCompanion.__handleFromWake(text);
                return;
            }
            if (window.GunterCompanion?.expand) {
                window.GunterCompanion.expand();
                setTimeout(() => {
                    const input = document.getElementById('gn-comp-input');
                    const form  = document.getElementById('gn-comp-form');
                    if (input && form) {
                        input.value = text;
                        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                    }
                }, 200);
            }
        } catch (e) { console.warn('[tutor-panel] talk fail:', e.message); }
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    /**
     * Wraps matched query tokens in <mark class="gtutor__hl">.
     * Preserva HTML-escape del texto plano.
     */
    function highlight(text, tokens) {
        if (!text || !tokens || !tokens.length) return esc(text);
        const escapedText = esc(text);
        // Los tokens vienen stemmed — usamos prefix match. Buscamos por variantes que empiecen igual.
        const patterns = tokens
            .filter(t => t.length >= 3)
            .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .sort((a, b) => b.length - a.length);   // más largos primero (menos falsos matches)
        if (patterns.length === 0) return escapedText;
        const re = new RegExp('\\b(' + patterns.join('|') + ')[a-zñáéíóúü]{0,4}', 'gi');
        return escapedText.replace(re, '<mark class="gtutor__hl">$&</mark>');
    }

    /**
     * TTS de un pasaje. Usa GunterVoice si está disponible con estilo tutor.
     * Se maneja en el propio panel para no romper el flujo del companion.
     */
    let _speaking = null;   // { button, cancel }
    function speakPassage(text, btnEl) {
        // Si ya está hablando este pasaje, stop
        if (_speaking && _speaking.button === btnEl) {
            _stopSpeak();
            return;
        }
        // Si está hablando otro, parar primero
        if (_speaking) _stopSpeak();

        const clean = String(text || '').trim();
        if (!clean) return;

        // Botón visual
        btnEl.classList.add('is-speaking');
        btnEl.textContent = '⏸';

        const done = () => {
            btnEl.classList.remove('is-speaking');
            btnEl.textContent = '🔊';
            _speaking = null;
        };

        // Preferir GunterVoice (OpenAI TTS con estilo)
        if (window.GunterVoice?.speak) {
            try {
                const p = window.GunterVoice.speak(clean, {
                    context: 'tutor-passage',
                    force: true,
                    onEnd: done,
                    onError: done
                });
                _speaking = { button: btnEl, cancel: () => window.GunterVoice.stop?.() };
                if (p && typeof p.then === 'function') p.then(done).catch(done);
                return;
            } catch { /* fallback */ }
        }

        // Fallback: SpeechSynthesis nativa
        if ('speechSynthesis' in window) {
            const u = new SpeechSynthesisUtterance(clean);
            u.lang = 'es-MX';
            u.rate = 1.0;
            u.onend = done;
            u.onerror = done;
            speechSynthesis.speak(u);
            _speaking = { button: btnEl, cancel: () => speechSynthesis.cancel() };
            return;
        }

        // Sin TTS disponible
        console.warn('[tutor-panel] no TTS available');
        done();
    }

    function _stopSpeak() {
        if (!_speaking) return;
        try { _speaking.cancel(); } catch {}
        _speaking.button.classList.remove('is-speaking');
        _speaking.button.textContent = '🔊';
        _speaking = null;
    }
    function _error(msg) {
        return `<div class="gtutor__empty"><p>${esc(msg)}</p></div>`;
    }

    // Re-render on flag changes
    if (window.PremiumFeaturesService?.subscribe) {
        window.PremiumFeaturesService.subscribe((key) => {
            if (host && (key === 'tutorMode' || key === null)) refresh().catch(() => {});
        });
    }

    window.GunterTutorPanel = { mount, refresh, openWork };
})();
