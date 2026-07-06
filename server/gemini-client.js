/* =============================================
   Server helper — Gemini (Google AI Studio)
   ---------------------------------------------
   Motor LLM completo de Gunter (v42 — sin OpenAI):
     generateText({messages|prompt})  chat (formato messages OpenAI)
     transcribeAudio(buffer, mime)    transcripción (reemplaza Whisper)
     embedTexts(texts)                embeddings 1536-dim (gemini-embedding-001)
     describeImage(buffer, mime)      visión (WhatsApp / recibos)

   Cadena de fallback: gemini-2.5-flash → gemini-2.5-flash-lite
   (si el primero devuelve 429/5xx se reintenta con el siguiente).
   ============================================= */

const https = require('https');

const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const TEXT_MODELS = (process.env.GEMINI_TEXT_MODELS || 'gemini-2.5-flash,gemini-2.5-flash-lite')
    .split(',').map(s => s.trim()).filter(Boolean);
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
const EMBED_DIMS = 1536;   // compatible con los vectores previos de text-embedding-3-small

function hasKey() { return !!KEY; }

// ---------- HTTP base ----------
function _post(pathName, bodyObj) {
    const data = JSON.stringify(bodyObj);
    const opts = {
        hostname: 'generativelanguage.googleapis.com',
        path: pathName,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': KEY,
            'Content-Length': Buffer.byteLength(data)
        }
    };
    return new Promise((resolve, reject) => {
        const req = https.request(opts, res => {
            let out = '';
            res.on('data', c => { out += c; });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    const err = new Error(`Gemini HTTP ${res.statusCode}: ${out.slice(0, 300)}`);
                    err.statusCode = res.statusCode;
                    return reject(err);
                }
                try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(data); req.end();
    });
}

// Reintenta por la cadena de modelos cuando hay 429 (cuota) o 5xx
async function _withModelFallback(fn) {
    let lastErr = null;
    for (const model of TEXT_MODELS) {
        try { return await fn(model); }
        catch (e) {
            lastErr = e;
            if (e.statusCode === 429 || (e.statusCode >= 500 && e.statusCode < 600)) {
                console.warn(`[gemini] ${model} → ${e.statusCode}; probando siguiente modelo…`);
                continue;
            }
            throw e;
        }
    }
    throw lastErr || new Error('Gemini: sin modelos disponibles');
}

function _extractText(parsed) {
    return (parsed?.candidates?.[0]?.content?.parts || [])
        .map(p => p.text || '').join('').trim();
}

// ---------- Chat (acepta messages estilo OpenAI) ----------
// messages: [{role:'system'|'user'|'assistant', content}] — devuelve string.
function generateText({ messages, prompt, temperature = 0.4, maxTokens = 900, jsonMode = false }) {
    if (!hasKey()) return Promise.reject(new Error('GEMINI_API_KEY missing'));

    let systemText = '';
    let contents = [];
    if (Array.isArray(messages) && messages.length) {
        for (const m of messages) {
            const text = typeof m.content === 'string' ? m.content
                : Array.isArray(m.content) ? m.content.map(c => c.text || '').join('\n') : '';
            if (m.role === 'system') { systemText += (systemText ? '\n\n' : '') + text; continue; }
            contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] });
        }
        // Gemini exige que contents no esté vacío y arranque con 'user'
        if (!contents.length) contents = [{ role: 'user', parts: [{ text: systemText || ' ' }] }];
        if (contents[0].role !== 'user') contents.unshift({ role: 'user', parts: [{ text: 'Continúa.' }] });
    } else {
        contents = [{ role: 'user', parts: [{ text: String(prompt || '') }] }];
    }

    const body = {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
            ...(jsonMode ? { responseMimeType: 'application/json' } : {})
        }
    };

    return _withModelFallback(async (model) => {
        const parsed = await _post(`/v1beta/models/${model}:generateContent`, body);
        return _extractText(parsed);
    });
}

// ---------- Transcripción de audio (reemplaza Whisper) ----------
function transcribeAudio(buffer, mimeType = 'audio/ogg', language = '') {
    if (!hasKey()) return Promise.reject(new Error('GEMINI_API_KEY missing'));
    const prompt = `Transcribe este audio de forma LITERAL y completa, en su idioma original${language ? ` (probablemente "${language}")` : ''}.
Reglas:
- Devuelve SOLO el texto transcrito, sin comentarios, sin markdown, sin timestamps.
- Conserva la puntuación natural del habla.
- Si el audio no contiene voz humana, devuelve una cadena vacía.`;

    const body = {
        contents: [{
            role: 'user',
            parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } }
            ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8000 }
    };

    return _withModelFallback(async (model) => {
        const parsed = await _post(`/v1beta/models/${model}:generateContent`, body);
        return _extractText(parsed);
    });
}

// ---------- Embeddings (reemplaza text-embedding-3-small) ----------
// texts: string | string[] — devuelve array de vectores (1536 dims).
async function embedTexts(texts) {
    if (!hasKey()) throw new Error('GEMINI_API_KEY missing');
    const list = Array.isArray(texts) ? texts : [texts];
    const body = {
        requests: list.map(t => ({
            model: `models/${EMBED_MODEL}`,
            content: { parts: [{ text: String(t).slice(0, 8000) }] },
            outputDimensionality: EMBED_DIMS
        }))
    };
    const parsed = await _post(`/v1beta/models/${EMBED_MODEL}:batchEmbedContents`, body);
    return (parsed.embeddings || []).map(e => e.values || []);
}

// ---------- Visión (WhatsApp imágenes / recibos) ----------
function describeImage(buffer, mimeType = 'image/jpeg', extraHint = '') {
    if (!hasKey()) return Promise.reject(new Error('GEMINI_API_KEY missing'));

    const prompt = `Describe esta imagen en español en ≤80 palabras.
Si es un recibo/factura: extrae empresa, valor, fecha de vencimiento.
Si es una foto de documento: resume su contenido.
Si es una imagen común: describe qué muestra.
${extraHint ? 'Contexto adicional: ' + extraHint : ''}
Responde texto plano, sin markdown.`;

    const body = {
        contents: [{
            role: 'user',
            parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } }
            ]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 400 }
    };

    return _withModelFallback(async (model) => {
        const parsed = await _post(`/v1beta/models/${model}:generateContent`, body);
        return _extractText(parsed);
    });
}

module.exports = {
    hasKey, generateText, transcribeAudio, embedTexts, describeImage,
    TEXT_MODELS, EMBED_MODEL, EMBED_DIMS
};
