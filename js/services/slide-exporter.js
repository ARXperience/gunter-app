/* =============================================
   GUNTER SERVICE - Slide Exporter (Fase 5)
   -------------------------------------------------
   Exporta el deck a:
     • PDF  — usando jsPDF (16:9 landscape)
     • PPTX — usando pptxgenjs (slides nativos editables)

   Para PDF usamos render rasterizado (html2canvas)
   sobre una hoja en pantalla con el slide-renderer
   activo. Para PPTX construimos slides programáticos
   respetando palette/typography del deck.

   API:
     await GunterSlideExport.toPDF(deck)
     await GunterSlideExport.toPPTX(deck)
   ============================================= */

(function () {
    const PX_PER_IN = 96;
    const PPT_W_IN = 13.333;   // widescreen 16:9
    const PPT_H_IN = 7.5;

    function safeFilename(title) {
        return String(title || 'gunter-deck')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
            .replace(/\s+/g, '_')
            .slice(0, 80);
    }

    function ensureLib(name, globalRef) {
        if (typeof globalRef !== 'undefined' && globalRef) return globalRef;
        throw new Error(`Falta la librería ${name}. Asegúrate de cargarla antes de exportar.`);
    }

    // ---------- PDF (raster, fiel al render visual) ----------
    async function toPDF(deck) {
        if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
            throw new Error('Deck vacío.');
        }
        const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        ensureLib('jsPDF', jsPDFCtor);
        ensureLib('html2canvas', window.html2canvas);
        ensureLib('GunterSlideRenderer', window.GunterSlideRenderer);

        const renderer = window.GunterSlideRenderer;
        const wasOpen = !!document.querySelector('.gslide-host');

        // Si el renderer no está abierto, lo abrimos invisiblemente (off-screen)
        // y rasterizamos cada slide pasando por todas.
        if (!wasOpen) renderer.open(deck);
        const host = document.querySelector('.gslide-host');
        if (!host) throw new Error('No pude inicializar el renderer.');

        // jsPDF landscape, A4 in pixels al ratio de pantalla del slide.
        const stage = host.querySelector('.gslide-stage');
        const w = stage.clientWidth;
        const h = stage.clientHeight;
        const pdf = new jsPDFCtor({
            orientation: 'landscape',
            unit: 'px',
            format: [w, h],
            hotfixes: ['px_scaling']
        });

        const total = deck.slides.length;
        for (let i = 0; i < total; i++) {
            renderer.go(i);
            // Esperar a que la animación de transición termine y la imagen cargue
            await sleep(700);
            const slideEl = host.querySelector(`.gslide[data-index="${i}"]`);
            if (!slideEl) continue;
            const canvas = await window.html2canvas(slideEl, {
                backgroundColor: deck.style?.palette?.bg || '#000',
                scale: 2,
                useCORS: true,
                logging: false,
                width: w,
                height: h,
                windowWidth: w,
                windowHeight: h
            });
            const imgData = canvas.toDataURL('image/jpeg', 0.92);
            if (i > 0) pdf.addPage([w, h], 'landscape');
            pdf.addImage(imgData, 'JPEG', 0, 0, w, h, undefined, 'FAST');
        }

        if (!wasOpen) renderer.close();

        const filename = `${safeFilename(deck.title)}_gunter.pdf`;
        pdf.save(filename);
        return { filename, pages: total };
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ---------- PPTX (nativo editable) ----------
    async function toPPTX(deck) {
        if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
            throw new Error('Deck vacío.');
        }
        ensureLib('pptxgenjs', window.PptxGenJS);

        const pptx = new window.PptxGenJS();
        pptx.layout = 'LAYOUT_WIDE';        // 13.333 × 7.5 in
        pptx.title = deck.title || 'Gunter Deck';
        pptx.author = 'Gunter';
        pptx.company = 'Gunter';

        const palette = deck.style?.palette || {
            bg: '#0a0f1c', surface: '#111827', accent: '#00d4ff', text: '#e5e7eb', muted: '#94a3b8'
        };
        const fonts = {
            heading: stripFontFamily(deck.style?.typography?.heading) || 'Calibri',
            body:    stripFontFamily(deck.style?.typography?.body) || 'Calibri'
        };
        const HEX = (c) => normalizeHex(c);

        // Define un master con el footer del proyecto y barra de acento
        pptx.defineSlideMaster({
            title: 'GUNTER_MASTER',
            background: { color: HEX(palette.bg) },
            objects: [
                { rect: { x: 0, y: 0, w: PPT_W_IN, h: 0.06, fill: { color: HEX(palette.accent) } } },
                {
                    text: {
                        text: deck.title || '',
                        options: {
                            x: 0.4, y: PPT_H_IN - 0.4, w: 6, h: 0.3,
                            fontSize: 9, color: HEX(palette.muted),
                            fontFace: fonts.body, charSpacing: 4
                        }
                    }
                }
            ]
        });

        for (let i = 0; i < deck.slides.length; i++) {
            const s = deck.slides[i];
            const slide = pptx.addSlide({ masterName: 'GUNTER_MASTER' });

            // Imagen de fondo si existe (data URL del Gemini)
            if (s.imageUrl && typeof s.imageUrl === 'string') {
                try {
                    slide.addImage({
                        data: s.imageUrl,    // dataURL ej. "data:image/png;base64,..."
                        x: 0, y: 0, w: PPT_W_IN, h: PPT_H_IN,
                        sizing: { type: 'cover', w: PPT_W_IN, h: PPT_H_IN }
                    });
                    // Overlay scrim para contraste
                    slide.addShape(pptx.ShapeType.rect, {
                        x: 0, y: 0, w: PPT_W_IN, h: PPT_H_IN,
                        fill: { color: HEX(palette.bg), transparency: 35 },
                        line: { type: 'none' }
                    });
                } catch (e) { /* imagen mal-formada → seguir sin ella */ }
            }

            // Número de slide
            slide.addText(String(i + 1).padStart(2, '0') + ' / ' + String(deck.slides.length).padStart(2, '0'), {
                x: PPT_W_IN - 1.2, y: PPT_H_IN - 0.4, w: 1, h: 0.3,
                fontSize: 9, color: HEX(palette.muted),
                fontFace: fonts.heading, align: 'right', charSpacing: 4
            });

            renderSlideBody(slide, s, deck, { palette, fonts, HEX, pptx });
        }

        const filename = `${safeFilename(deck.title)}_gunter.pptx`;
        await pptx.writeFile({ fileName: filename });
        return { filename, pages: deck.slides.length };
    }

    function renderSlideBody(slide, s, deck, ctx) {
        const { palette, fonts, HEX, pptx } = ctx;
        const type = s.type || 'bullets';

        // Eyebrow common
        const eyebrow = s.subtitle && type !== 'cover' && type !== 'closing'
            ? s.subtitle.toUpperCase()
            : (s.footer ? s.footer.toUpperCase() : (type === 'cover' ? 'PRESENTACIÓN ESTRATÉGICA' : ''));

        if (type === 'cover' || type === 'closing') {
            // Hero centered
            if (eyebrow) {
                slide.addText(eyebrow, {
                    x: 0.5, y: 1.2, w: PPT_W_IN - 1, h: 0.4,
                    fontSize: 12, color: HEX(palette.accent),
                    fontFace: fonts.body, charSpacing: 6, align: 'center', bold: true
                });
            }
            slide.addText(s.title || deck.title || '', {
                x: 0.5, y: 1.7, w: PPT_W_IN - 1, h: 2.2,
                fontSize: 60, color: HEX(palette.text),
                fontFace: fonts.heading, align: 'center', bold: true,
                fit: 'shrink', valign: 'middle'
            });
            const sub = s.subtitle || deck.subtitle;
            if (sub && type === 'cover') {
                slide.addText(sub, {
                    x: 1, y: 4.1, w: PPT_W_IN - 2, h: 1.4,
                    fontSize: 20, color: HEX(palette.muted),
                    fontFace: fonts.body, align: 'center', valign: 'top'
                });
            }
            if (Array.isArray(s.bullets) && s.bullets.length) {
                const pillsText = s.bullets.slice(0, 4).map(b => '·  ' + b).join('     ');
                slide.addText(pillsText, {
                    x: 0.5, y: 5.6, w: PPT_W_IN - 1, h: 0.6,
                    fontSize: 14, color: HEX(palette.text),
                    fontFace: fonts.body, align: 'center'
                });
            }
            return;
        }

        if (type === 'quote') {
            if (eyebrow) {
                slide.addText(eyebrow, {
                    x: 0.6, y: 0.8, w: PPT_W_IN - 1.2, h: 0.4,
                    fontSize: 11, color: HEX(palette.accent),
                    fontFace: fonts.body, charSpacing: 6, align: 'center', bold: true
                });
            }
            slide.addText('"' + (s.quote || s.title || '') + '"', {
                x: 1, y: 1.6, w: PPT_W_IN - 2, h: 4.2,
                fontSize: 36, color: HEX(palette.text),
                fontFace: fonts.heading, italic: true, align: 'center', valign: 'middle',
                fit: 'shrink'
            });
            if (s.title && s.quote) {
                slide.addText('— ' + s.title, {
                    x: 1, y: 6.0, w: PPT_W_IN - 2, h: 0.4,
                    fontSize: 13, color: HEX(palette.muted),
                    fontFace: fonts.body, align: 'center', charSpacing: 4
                });
            }
            return;
        }

        if (type === 'kpi') {
            if (eyebrow) {
                slide.addText(eyebrow, {
                    x: 0.6, y: 0.8, w: PPT_W_IN - 1.2, h: 0.4,
                    fontSize: 11, color: HEX(palette.accent),
                    fontFace: fonts.body, charSpacing: 6, bold: true
                });
            }
            slide.addText(s.title || '', {
                x: 0.6, y: 1.3, w: PPT_W_IN - 1.2, h: 0.7,
                fontSize: 30, color: HEX(palette.text),
                fontFace: fonts.heading, bold: true, fit: 'shrink'
            });
            const m = s.metric || {};
            slide.addText(m.value || '—', {
                x: 0.6, y: 2.4, w: PPT_W_IN - 1.2, h: 2.6,
                fontSize: 130, color: HEX(palette.accent),
                fontFace: fonts.heading, bold: true, valign: 'middle', fit: 'shrink'
            });
            if (m.label) {
                slide.addText(String(m.label).toUpperCase(), {
                    x: 0.6, y: 5.1, w: PPT_W_IN - 1.2, h: 0.4,
                    fontSize: 11, color: HEX(palette.muted),
                    fontFace: fonts.body, charSpacing: 4
                });
            }
            if (Array.isArray(s.bullets) && s.bullets.length) {
                slide.addText(s.bullets.slice(0, 3).map(b => ({ text: b, options: { bullet: { code: '25CF' } } })), {
                    x: 0.6, y: 5.6, w: PPT_W_IN - 1.2, h: 1.3,
                    fontSize: 13, color: HEX(palette.text),
                    fontFace: fonts.body, paraSpaceAfter: 4
                });
            }
            return;
        }

        // Default: bullets / section
        if (eyebrow) {
            slide.addText(eyebrow, {
                x: 0.6, y: 0.8, w: PPT_W_IN - 1.2, h: 0.4,
                fontSize: 11, color: HEX(palette.accent),
                fontFace: fonts.body, charSpacing: 6, bold: true
            });
        }
        slide.addText(s.title || '', {
            x: 0.6, y: 1.3, w: PPT_W_IN - 1.2, h: 1.2,
            fontSize: 36, color: HEX(palette.text),
            fontFace: fonts.heading, bold: true, fit: 'shrink'
        });
        if (Array.isArray(s.bullets) && s.bullets.length) {
            const items = s.bullets.slice(0, 5).map(b => ({
                text: String(b),
                options: { bullet: { code: '25CF', color: stripHash(HEX(palette.accent)) } }
            }));
            slide.addText(items, {
                x: 0.6, y: 2.7, w: PPT_W_IN - 1.2, h: 4.2,
                fontSize: 16, color: HEX(palette.text),
                fontFace: fonts.body, paraSpaceAfter: 8, valign: 'top'
            });
        }
    }

    // ---------- helpers ----------
    function stripFontFamily(css) {
        if (!css) return '';
        // toma el primer nombre, sin comillas
        const first = String(css).split(',')[0].trim();
        return first.replace(/^['"]|['"]$/g, '');
    }

    function normalizeHex(c) {
        if (!c) return '000000';
        const m = String(c).trim().match(/^#?([0-9a-fA-F]{6})$/);
        if (m) return m[1].toUpperCase();
        // 3-digit shorthand
        const m3 = String(c).trim().match(/^#?([0-9a-fA-F]{3})$/);
        if (m3) {
            const [r, g, b] = m3[1].split('');
            return (r + r + g + g + b + b).toUpperCase();
        }
        // rgb()/rgba() — parsear
        const rgb = String(c).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (rgb) {
            return [rgb[1], rgb[2], rgb[3]].map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('').toUpperCase();
        }
        return '000000';
    }

    function stripHash(hex) {
        return String(hex || '').replace(/^#/, '');
    }

    window.GunterSlideExport = { toPDF, toPPTX };
})();
