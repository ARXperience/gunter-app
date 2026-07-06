/* =============================================
   GUNTER APP - Slide Generator
   -------------------------------------------------
   Convierte los análisis completados en un deck de
   diapositivas reales. Usa Gemini para:
     • planificar el deck (texto estructurado JSON)
     • generar las ilustraciones (gemini-2.5-flash-image)

   Estilos de diapositiva predefinidos + mapeo
   sugerido por tipo de proyecto.
   ============================================= */

(function () {
    const SLIDE_STYLES = {
        corporate_sleek: {
            id: 'corporate_sleek',
            name: 'Corporate Sleek',
            description: 'Presentación de directorio: limpia, datos primero, azul acero.',
            recommendedFor: ['empresarial'],
            palette: { bg: '#0a0f1c', surface: '#111827', accent: '#00d4ff', text: '#e5e7eb', muted: '#94a3b8' },
            typography: { heading: "'Outfit', sans-serif", body: "'Inter', sans-serif" },
            imageStyle: 'Minimalist 3D isometric illustration, corporate blue gradient (navy to cyan), subtle geometric shapes, clean white background accents, business-editorial aesthetic, soft rim light, 4k, high detail'
        },
        editorial_avantgarde: {
            id: 'editorial_avantgarde',
            name: 'Editorial Avant-garde',
            description: 'Revista de diseño: tipografía audaz, colores vibrantes, composición asimétrica.',
            recommendedFor: ['artistico'],
            palette: { bg: '#140a1f', surface: '#1c0f2e', accent: '#ff006e', text: '#fef2f2', muted: '#c4b5fd' },
            typography: { heading: "'Playfair Display', serif", body: "'Inter', sans-serif" },
            imageStyle: 'Editorial magazine collage, bold magenta and electric violet palette, mixed media textures, cutout photography, avant-garde composition, paper grain, oversized typography hints, gallery-quality'
        },
        studio_lofi: {
            id: 'studio_lofi',
            name: 'Studio Lo-Fi',
            description: 'Cover de podcast: cálido, ámbar y púrpura, texturas de vinyl.',
            recommendedFor: ['podcast'],
            palette: { bg: '#1a0f05', surface: '#2a1a08', accent: '#ffaa00', text: '#fff7ed', muted: '#fcd34d' },
            typography: { heading: "'Outfit', sans-serif", body: "'Inter', sans-serif" },
            imageStyle: 'Lo-fi podcast cover art, warm amber and deep purple, analog grain, cassette tape and vinyl textures, silhouettes, neon signage glow, retro 80s studio vibe, richly saturated'
        },
        serene_sage: {
            id: 'serene_sage',
            name: 'Serene Sage',
            description: 'Estético zen: mucho espacio negativo, dorado suave, pincelada sumi-e.',
            recommendedFor: ['zen'],
            palette: { bg: '#12110e', surface: '#1c1b14', accent: '#e8c87a', text: '#f3f0e4', muted: '#b8a774' },
            typography: { heading: "'Playfair Display', serif", body: "'Inter', sans-serif" },
            imageStyle: 'Japanese sumi-e ink painting, minimal, warm gold and soft jade accents on aged rice paper, single elegant brushstroke motif, wabi-sabi, quiet negative space, calm and contemplative'
        },
        investor_pitch: {
            id: 'investor_pitch',
            name: 'Investor Pitch',
            description: 'Formato Silicon Valley: bold, oscuro, iconografía flat, CTA fuerte.',
            recommendedFor: ['empresarial', 'podcast'],
            palette: { bg: '#000000', surface: '#0a0a0a', accent: '#10b981', text: '#ffffff', muted: '#9ca3af' },
            typography: { heading: "'Outfit', sans-serif", body: "'Inter', sans-serif" },
            imageStyle: 'Flat vector startup pitch illustration, bold emerald green accents on deep black, clean modern shapes, data visualization motifs, SaaS aesthetic, crisp edges'
        },
        creative_studio: {
            id: 'creative_studio',
            name: 'Creative Studio',
            description: 'Pitch creativo/agencia: vibrante, fotográfico, líneas manuscritas.',
            recommendedFor: ['artistico', 'zen', 'podcast'],
            palette: { bg: '#0f0f0f', surface: '#1a1a1a', accent: '#f472b6', text: '#fafafa', muted: '#d4d4d8' },
            typography: { heading: "'Outfit', sans-serif", body: "'Inter', sans-serif" },
            imageStyle: 'Creative agency moodboard, cinematic lighting, high-contrast photography meets hand-drawn accents, vibrant pink and warm neutrals, artful composition, layered textures'
        }
    };

    function stylesFor(environment) {
        // Always allow all; surface the recommended first.
        return Object.values(SLIDE_STYLES).sort((a, b) => {
            const aRec = (a.recommendedFor || []).includes(environment) ? 0 : 1;
            const bRec = (b.recommendedFor || []).includes(environment) ? 0 : 1;
            return aRec - bRec;
        });
    }

    // ---------- Deck planning ----------
    // Given the completed analyses + meeting transcript, plan a coherent deck.
    async function planDeck({ projectInfo, environment, analyses, styleDef, transcript }) {
        const analysesSummary = analyses.map(a => ({
            id: a.analysisId,
            title: a.definition.title,
            methodology: a.definition.methodology,
            payload: a.payload
        }));

        const transcriptExcerpt = (transcript || '').slice(0, 2500).trim();

        const prompt = `Eres un director creativo de presentaciones estratégicas (nivel McKinsey / TED / Apple Keynote).
Tu trabajo: transformar una reunión real + los análisis ya producidos en un DECK NARRATIVO, visual, en ESPAÑOL NEUTRO.

=== CONTEXTO DEL PROYECTO ===
- Nombre: ${projectInfo.name || 'Sin título'}
- Entorno: ${environment}
- Mercado / tema: ${projectInfo.market || 'No especificado'}

=== FRAGMENTO DE LA TRANSCRIPCIÓN ORIGINAL (para mantener tu texto ANCLADO a lo que realmente se dijo) ===
"""
${transcriptExcerpt}
"""

=== ANÁLISIS ESTRATÉGICOS YA PRODUCIDOS (tu fuente principal) ===
${JSON.stringify(analysesSummary).slice(0, 9000)}

=== ESTILO VISUAL: ${styleDef.name} ===
${styleDef.description}

=== TAREA ===
Diseña un deck de 7-10 diapositivas que cuente una HISTORIA coherente, no una lista.
Estructura recomendada:
  1. cover — título potente + promesa central en 1 línea.
  2. section|bullets — contexto del proyecto / por qué importa (sacado de la transcripción).
  3. bullets|kpi — hallazgos clave extraídos de los análisis.
  4. quote — una cita textual o parafraseada de la transcripción que destile la esencia.
  5. bullets — oportunidades o próximas decisiones (según los análisis).
  6. kpi — métrica ancla del proyecto si existe (duración, presupuesto, score de riesgo, etc.).
  7. bullets — plan de acción: 3-4 primeros movimientos concretos.
  8. closing — llamado a la acción + cierre memorable.

=== REGLAS ESTRICTAS ===
1. TODO el texto visible (title, subtitle, bullets, quote, metric.label, footer) debe estar en ESPAÑOL NEUTRO.
2. NO INVENTES datos. Cada afirmación debe derivar de la transcripción o de los análisis. Si algo no está, no lo pongas.
3. TÍTULOS cortos y afilados: máximo 8 palabras.
4. BULLETS: 3-5 por diapositiva, cada uno máx. 14 palabras. Nunca empieces con "Los", "El", "La" genéricos — arranca con un verbo en infinitivo o un sustantivo potente.
5. QUOTE: si incluyes una, que sea una frase extraída o parafraseada de la transcripción real. Máx. 25 palabras.
6. METRIC: usa solo si aparece una cifra/dato concreto. Formato { label: "Presupuesto", value: "$12k" }.
7. IMAGE_PROMPT (en INGLÉS, 40-80 palabras): describe una IMAGEN CONCEPTUAL directamente ligada al CONTENIDO específico de esa slide (no genérica).
   - Debe reflejar la METÁFORA VISUAL del título y bullets. Ejemplo: si el título habla de "expansión a 3 mercados", la imagen puede mostrar tres senderos convergentes; si habla de "riesgo financiero", una estructura arquitectónica frágil.
   - Referencia el DOMINIO real: si es finanzas, mostrar objetos/materiales financieros; si es tecnología, mostrar interfaces/dispositivos; si es narrativa, mostrar escenografía cinematográfica.
   - Especifica LUZ, ÁNGULO, MATERIAL. Ejemplo: "close-up of brushed brass structural beams, low key lighting, single warm rim light from left, shallow depth of field".
   - NUNCA texto/letras/números/logos dentro de la imagen (esos van encima como overlay). NUNCA gente de stock genérica (equipo alrededor del laptop, apretones de mano, gráficos subiendo).
   - El sistema añadirá reglas de composición y aesthetic del theme al prompt final — TU prompt solo debe cubrir el CONCEPTO específico de la slide.

=== FORMATO DE RESPUESTA ===
Devuelve EXCLUSIVAMENTE un JSON con este esquema (sin markdown, sin \`\`\`):
{
  "title": "Título del deck (en español)",
  "subtitle": "Una frase que resuma la promesa del proyecto",
  "slides": [
    {
      "type": "cover|section|kpi|bullets|quote|closing",
      "title": "Título corto en español",
      "subtitle": "Subtítulo opcional en español",
      "bullets": ["Viñeta 1", "Viñeta 2", "Viñeta 3"],
      "metric": { "label": "Etiqueta en español", "value": "valor" },
      "quote": "Cita en español si aplica",
      "image_prompt": "Conceptual illustration in English describing the slide visual — no text.",
      "footer": "Origen breve en español"
    }
  ]
}

La primera diapositiva DEBE ser type:"cover". La última DEBE ser type:"closing".`;

        const cfg = window.GUNTER_CONFIG || {};
        const url = cfg.PROXY_GEMINI_TEXT_URL || '/api/gemini-text';

        // Try Gemini first; fall back to OpenAI if Gemini not available
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    temperature: 0.5,
                    maxTokens: 3000,
                    responseMimeType: 'application/json'
                })
            });
            if (resp.ok) {
                const data = await resp.json();
                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                return extractJson(text);
            }
            // 503 when key missing → fallback
        } catch (e) { /* fallback */ }

        // --- Fallback: OpenAI via proxy/chat ---
        const chatUrl = cfg.PROXY_CHAT_URL || '/api/chat';
        const body = {
            model: cfg.CHAT_MODEL || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'Diseñas decks de diapositivas. Respondes ÚNICAMENTE con JSON válido que cumpla el esquema pedido.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.5,
            max_tokens: 3000,
            response_format: { type: 'json_object' }
        };
        const resp = await fetch(chatUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error('AI planner HTTP ' + resp.status);
        const data = await resp.json();
        return extractJson(data.choices?.[0]?.message?.content || '');
    }

    function extractJson(text) {
        if (!text) throw new Error('Respuesta vacía del planificador.');
        try { return JSON.parse(text); } catch { }
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('No se pudo extraer JSON del deck.');
        return JSON.parse(m[0]);
    }

    // ---------- Image generation ----------
    async function checkGeminiAvailable() {
        try {
            const cfg = window.GUNTER_CONFIG || {};
            const resp = await fetch(cfg.PROXY_GEMINI_STATUS_URL || '/api/gemini-status');
            if (!resp.ok) return false;
            const data = await resp.json();
            return !!data.available;
        } catch {
            return false;
        }
    }

    // Aesthetic per theme — cada uno dirige un lenguaje visual coherente
    // y profesional. Cartoon solo donde encaja (creative_studio zen, quizás lo-fi).
    const THEME_AESTHETIC = {
        corporate_sleek: {
            direction: 'editorial business photography meets minimal 3D abstract, high-key studio lighting, deep depth of field, brushed metal and glass materials, subtle gradient sky, Bloomberg / Financial Times cover quality',
            mood: 'confident, precise, restrained',
            palette: 'deep navy #0a0f1c, brushed steel, cool cyan #00d4ff accent as a single glow',
            negative: 'no cartoon, no illustration, no clip art, no stock photo cliches, no handshakes, no rising graphs cliché, no diverse-team-around-laptop stock, no lens flare cheese'
        },
        editorial_avantgarde: {
            direction: 'editorial fashion magazine cover art, mixed media collage, bold cutout photography with paper grain, oversized typography-space composition, high contrast, Wallpaper* magazine aesthetic',
            mood: 'audacious, cultured, contemporary',
            palette: 'deep aubergine #140a1f base, electric magenta #ff006e as focal accent, warm cream highlights',
            negative: 'no low-res, no watermark, no clip art, no cheesy gradients, no Instagram filter looks, no random abstract blobs'
        },
        studio_lofi: {
            direction: 'lofi podcast cover illustration meets warm ambient photography, analog film grain, vinyl and cassette textures, silhouettes with soft neon rim light, 80s studio memory, Wong Kar-wai warmth',
            mood: 'intimate, warm, contemplative',
            palette: 'deep espresso #1a0f05 base, warm amber #ffaa00 glow, muted violet shadows',
            negative: 'no photorealism sharp, no bright daylight, no clean corporate look, no clip-art headphones, no basic stock studio setup'
        },
        serene_sage: {
            direction: 'Japanese sumi-e ink painting on aged rice paper, single elegant brushstroke motif, wabi-sabi negative space, warm gold leaf accent, MoMA-grade minimalism',
            mood: 'quiet, contemplative, reverent',
            palette: 'aged rice paper cream #f3f0e4, soft charcoal ink, warm gold #e8c87a as a single restrained highlight',
            negative: 'no photorealism, no bright modern illustration, no clip art, no busy composition, no cartoon, no Western minimalism cliché'
        },
        investor_pitch: {
            direction: 'Silicon Valley pitch deck cover art, data visualization aesthetic, geometric abstract shapes on deep black, neon accent glow, SaaS product hero, Behance / Dribbble top-tier quality',
            mood: 'bold, ambitious, precise',
            palette: 'true black #000, emerald #10b981 as single high-energy accent, cool platinum highlights',
            negative: 'no illustration cartoon, no handshake cliché, no random gears, no stock businessman, no rocket cliché, no arrow-going-up cliché'
        },
        creative_studio: {
            direction: 'creative agency moodboard, cinematic photography meets hand-drawn accents, layered textures, painterly light, Vogue meets IDEO aesthetic',
            mood: 'expressive, elevated, artful',
            palette: 'off-black #0f0f0f base, warm pink #f472b6 as focal accent, warm neutrals',
            negative: 'no stock photo, no clip art, no cartoon childish, no basic vector, no chaotic composition, no random neon'
        }
    };

    /**
     * Genera una imagen conceptual coherente con:
     *  1. El contenido específico de la slide (anchor semántico)
     *  2. La estética del theme elegido (no todos son cartoon)
     *  3. Reglas de composición para integración profesional con el texto
     */
    async function generateImage(prompt, styleDef, slideContext = {}) {
        const cfg = window.GUNTER_CONFIG || {};
        const url = cfg.PROXY_GEMINI_IMAGE_URL || '/api/gemini-image';

        const aesthetic = THEME_AESTHETIC[styleDef.id] || THEME_AESTHETIC.corporate_sleek;

        // Anchor: qué representa esta slide realmente
        const anchor = [
            slideContext.title    ? `Slide title: "${slideContext.title}"` : '',
            slideContext.subtitle ? `Slide subtitle: "${slideContext.subtitle}"` : '',
            (slideContext.bullets && slideContext.bullets.length)
                ? `Key points: ${slideContext.bullets.slice(0, 3).join(' | ')}`
                : ''
        ].filter(Boolean).join('. ');

        // Reglas de composición según el tipo de layout
        const layoutType = slideContext.layout || 'editorial-right';
        const compositionByLayout = {
            'hero-full':      'full-bleed hero composition, subject centered with generous breathing room, cinematic 16:9, safe-zone in the lower third for text overlay',
            'editorial-left': 'subject and detail on the LEFT 45% of the frame, RIGHT 55% must be a flat solid or gradient background of the palette color for clean text overlay, no important detail on the right half',
            'editorial-right':'subject and detail on the RIGHT 45% of the frame, LEFT 55% must be a flat solid or gradient background of the palette color for clean text overlay, no important detail on the left half',
            'pull-quote':     'sparse editorial composition, subject in the upper 50% only, ample negative space in the lower half for a large pull quote',
            'kpi-hero':       'abstract data-driven composition (waves, mesh, geometric flows), no literal chart, subject in the RIGHT 40% with soft focal glow, LEFT 60% clean for a giant number'
        };
        const composition = compositionByLayout[layoutType] || compositionByLayout['editorial-right'];

        // Quality boosters + integración profesional
        const quality = [
            'editorial magazine quality',
            'coherent color grading',
            'controlled highlights and shadows',
            'physically plausible lighting',
            'no compression artifacts',
            'high dynamic range',
            '16:9 aspect ratio'
        ].join(', ');

        // Negative prompt combinado
        const negative = [
            'NO text of any kind (no letters, no numbers, no logos, no watermarks, no labels)',
            'NO speech bubbles, NO captions, NO UI elements',
            'NO low-quality artifacts, NO jpeg compression, NO blurry areas',
            aesthetic.negative
        ].join('. ');

        const composedPrompt = [
            // 1. Topic anchor
            `Conceptual visual for a strategic presentation slide.`,
            anchor ? `${anchor}. Concept described: ${prompt}` : `Concept: ${prompt}`,
            // 2. Aesthetic
            `Art direction: ${aesthetic.direction}. Mood: ${aesthetic.mood}. Palette: ${aesthetic.palette}.`,
            // 3. Extra style override del theme (imageStyle)
            styleDef.imageStyle ? `Additional style: ${styleDef.imageStyle}` : '',
            // 4. Composition
            `Composition: ${composition}.`,
            // 5. Quality
            `Technical: ${quality}.`,
            // 6. Negative
            `STRICT: ${negative}.`
        ].filter(Boolean).join(' ');

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: composedPrompt })
        });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            throw new Error(`Gemini image HTTP ${resp.status}: ${txt.slice(0, 200)}`);
        }
        const data = await resp.json();
        return data.dataUrl;
    }

    /**
     * Build the full deck (plan + images).
     * Emits progress events via onProgress({ step, total, percent, message }).
     */
    async function buildDeck({ projectInfo, environment, analyses, styleId, transcript = '', onProgress = () => { }, includeImages = true }) {
        const styleDef = SLIDE_STYLES[styleId];
        if (!styleDef) throw new Error('Estilo desconocido: ' + styleId);
        if (!analyses || analyses.length === 0) {
            throw new Error('Necesitas al menos un análisis completado antes de generar la presentación.');
        }

        onProgress({ step: 0, total: 1, percent: 5, message: 'Planificando el deck con IA…' });
        const plan = await planDeck({ projectInfo, environment, analyses, styleDef, transcript });
        const slides = Array.isArray(plan.slides) ? plan.slides : [];
        if (slides.length === 0) throw new Error('El planificador no devolvió diapositivas.');

        // Generate images (if Gemini available and requested)
        const geminiOk = includeImages ? await checkGeminiAvailable() : false;

        // Predefinir layout por slide (afecta composición de imagen).
        // El renderer también lo usa via pickLayout — mantener paridad.
        function pickLayoutForImage(type, index) {
            if (type === 'cover')   return 'hero-full';
            if (type === 'closing') return 'hero-full';
            if (type === 'kpi')     return 'kpi-hero';
            if (type === 'quote')   return 'pull-quote';
            // bullets/section alternan editorial
            return index % 2 === 0 ? 'editorial-right' : 'editorial-left';
        }

        for (let i = 0; i < slides.length; i++) {
            const s = slides[i];
            const percent = 10 + Math.floor((i / slides.length) * 85);
            if (geminiOk && s.image_prompt) {
                onProgress({ step: i + 1, total: slides.length, percent, message: `Ilustrando diapositiva ${i + 1} de ${slides.length}…` });
                try {
                    const slideContext = {
                        title: s.title,
                        subtitle: s.subtitle,
                        bullets: s.bullets,
                        layout: pickLayoutForImage(s.type, i),
                        type: s.type
                    };
                    s.imageUrl = await generateImage(s.image_prompt, styleDef, slideContext);
                    s.layoutHint = slideContext.layout;
                } catch (err) {
                    console.warn('Image gen failed for slide', i, err);
                    s.imageUrl = null;
                    s.imageError = err.message;
                }
            } else {
                s.imageUrl = null;
            }
        }

        onProgress({ step: slides.length, total: slides.length, percent: 100, message: 'Deck listo ✓' });

        return {
            title: plan.title || projectInfo.name || 'Presentación',
            subtitle: plan.subtitle || '',
            style: styleDef,
            slides,
            generatedAt: Date.now(),
            projectInfo,
            environment,
            geminiImages: geminiOk
        };
    }

    window.GunterSlides = {
        styles: SLIDE_STYLES,
        stylesFor,
        checkGeminiAvailable,
        buildDeck
    };
})();
