/* =============================================
   Server helper — Fallback LLM (v46)
   ---------------------------------------------
   Respaldo GRATUITO para cuando la cuota diaria de Gemini se agota.
   Cadena de proveedores (se usan solo los que tengan key en .env;
   Pollinations no necesita key y siempre está al final):

     1. Groq        GROQ_API_KEY        llama-3.3-70b (free tier ~14k req/día, muy rápido)
     2. OpenRouter  OPENROUTER_API_KEY  modelos :free (~50-1000 req/día)
     3. Mistral     MISTRAL_API_KEY     mistral-small (free tier)
     4. Pollinations (sin key)          último recurso, calidad variable

   Todos hablan el formato OpenAI chat/completions → cero adaptación
   en los consumidores. Groq además da Whisper gratis (transcripción).
   ============================================= */

const https = require('https');

const PROVIDERS = [
    {
        name: 'groq',
        hasKey: () => !!process.env.GROQ_API_KEY,
        host: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        auth: () => 'Bearer ' + process.env.GROQ_API_KEY,
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        supportsJsonMode: true
    },
    {
        name: 'openrouter',
        hasKey: () => !!process.env.OPENROUTER_API_KEY,
        host: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        auth: () => 'Bearer ' + process.env.OPENROUTER_API_KEY,
        model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
        supportsJsonMode: false
    },
    {
        name: 'mistral',
        hasKey: () => !!process.env.MISTRAL_API_KEY,
        host: 'api.mistral.ai',
        path: '/v1/chat/completions',
        auth: () => 'Bearer ' + process.env.MISTRAL_API_KEY,
        model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
        supportsJsonMode: true
    },
    {
        name: 'pollinations',
        hasKey: () => true,   // sin key — comunitario, último recurso
        host: 'text.pollinations.ai',
        path: '/openai/chat/completions',
        auth: () => null,
        model: 'openai',
        supportsJsonMode: false
    }
];

function activeProviders() {
    return PROVIDERS.filter(p => p.hasKey()).map(p => p.name);
}

function _post(host, pathName, bodyObj, authHeader, timeoutMs = 45000) {
    const data = JSON.stringify(bodyObj);
    const opts = {
        hostname: host,
        path: pathName,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            ...(authHeader ? { 'Authorization': authHeader } : {})
        },
        timeout: timeoutMs
    };
    return new Promise((resolve, reject) => {
        const req = https.request(opts, res => {
            let out = '';
            res.on('data', c => { out += c; });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    const err = new Error(`${host} HTTP ${res.statusCode}: ${out.slice(0, 200)}`);
                    err.statusCode = res.statusCode;
                    return reject(err);
                }
                try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
            });
        });
        req.on('timeout', () => { req.destroy(new Error(host + ' timeout')); });
        req.on('error', reject);
        req.write(data); req.end();
    });
}

// Si el proveedor no soporta json_object nativo, se instruye por prompt
// y se limpian fences de markdown de la respuesta.
function _stripFences(text) {
    return String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

/** Chat con la cadena de respaldo. Devuelve el string de contenido.
 *  Cada proveedor se intenta hasta 2 veces si el fallo es transitorio
 *  (5xx/timeout) — Pollinations en particular parpadea a veces. */
async function chatComplete({ messages, temperature = 0.4, maxTokens = 900, jsonMode = false }) {
    const active = PROVIDERS.filter(p => p.hasKey());
    let lastErr = null;
    for (const p of active) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                let msgs = messages;
                if (jsonMode && !p.supportsJsonMode) {
                    msgs = [...messages, { role: 'system', content: 'Responde ÚNICAMENTE con JSON válido. Sin markdown, sin texto extra.' }];
                }
                const body = {
                    model: p.model,
                    messages: msgs,
                    temperature,
                    max_tokens: maxTokens,
                    ...(jsonMode && p.supportsJsonMode ? { response_format: { type: 'json_object' } } : {})
                };
                const parsed = await _post(p.host, p.path, body, p.auth());
                const content = parsed?.choices?.[0]?.message?.content || '';
                if (!content.trim()) throw new Error(p.name + ': respuesta vacía');
                console.log(`🛟 [fallback-llm] respondió ${p.name} (${p.model})`);
                return jsonMode ? _stripFences(content) : content;
            } catch (e) {
                lastErr = e;
                const transient = !e.statusCode || e.statusCode >= 500 || /timeout/i.test(e.message);
                console.warn(`[fallback-llm] ${p.name} falló (intento ${attempt + 1}): ${e.message.slice(0, 100)}`);
                if (!transient) break;                          // 4xx: siguiente proveedor ya
                if (attempt === 0) await new Promise(r => setTimeout(r, 2500));
            }
        }
    }
    throw lastErr || new Error('Sin proveedores de respaldo disponibles');
}

/** Transcripción de respaldo via Groq Whisper (gratis, solo si hay GROQ_API_KEY). */
function transcribeAudio(buffer, mimeType = 'audio/ogg', language = 'es') {
    if (!process.env.GROQ_API_KEY) {
        return Promise.reject(new Error('Transcripción de respaldo requiere GROQ_API_KEY (gratis en console.groq.com)'));
    }
    return new Promise((resolve, reject) => {
        const boundary = '----gunterfb' + Date.now().toString(36);
        const parts = [];
        const field = (name, value) => parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
        field('model', 'whisper-large-v3');
        field('language', language || 'es');
        field('response_format', 'json');
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio"\r\nContent-Type: ${mimeType}\r\n\r\n`));
        parts.push(buffer);
        parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
        const payload = Buffer.concat(parts);

        const req = https.request({
            hostname: 'api.groq.com',
            path: '/openai/v1/audio/transcriptions',
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': payload.length
            }
        }, res => {
            let out = '';
            res.on('data', c => { out += c; });
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`Groq Whisper HTTP ${res.statusCode}: ${out.slice(0, 200)}`));
                try { resolve(JSON.parse(out).text || ''); } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(payload); req.end();
    });
}

module.exports = { chatComplete, transcribeAudio, activeProviders };
