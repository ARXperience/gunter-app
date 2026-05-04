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
7. IMAGE_PROMPT (en INGLÉS, 30-60 palabras): describe una ILUSTRACIÓN CONCEPTUAL relacionada semánticamente con esa diapositiva concreta. Sin texto/letras/números dentro de la imagen. Cinematográfica, editorial, 16:9, deja espacio vacío a la derecha o abajo para superponer el texto.

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

    async function generateImage(prompt, styleDef) {
        const cfg = window.GUNTER_CONFIG || {};
        const url = cfg.PROXY_GEMINI_IMAGE_URL || '/api/gemini-image';
        const composedPrompt = `${prompt}. Style: ${styleDef.imageStyle}. No text, no words, no letters inside the image. 16:9 aspect ratio composition with generous negative space for overlay text on the right or bottom.`;
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

        for (let i = 0; i < slides.length; i++) {
            const s = slides[i];
            const percent = 10 + Math.floor((i / slides.length) * 85);
            if (geminiOk && s.image_prompt) {
                onProgress({ step: i + 1, total: slides.length, percent, message: `Ilustrando diapositiva ${i + 1} de ${slides.length}…` });
                try {
                    s.imageUrl = await generateImage(s.image_prompt, styleDef);
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
