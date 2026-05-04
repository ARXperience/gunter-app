// =============================================
// GUNTER APP - Simple Proxy Server for OpenAI API
// Solves CORS issues for audio transcription
// =============================================

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// WhatsApp integration (lazy required so the app runs even if deps missing)
let wa = null, waStore = null, waMemory = null, waPersonality = null, waMirror = null;
try {
    wa = require('./server/whatsapp');
    waStore = require('./server/whatsapp/message-log');
    waMemory = require('./server/whatsapp/memory');
    waPersonality = require('./server/whatsapp/personality');
    waMirror = require('./server/whatsapp/state-mirror');
} catch (e) {
    console.warn('⚠️  WhatsApp module not available:', e.message);
}

let knowledge = null;
try {
    knowledge = require('./server/knowledge');
} catch (e) {
    console.warn('⚠️  Knowledge module not available:', e.message);
}

let premiumIntel = null;
try {
    premiumIntel = require('./server/premium-intel');
} catch (e) {
    console.warn('⚠️  Premium-intel module not available:', e.message);
}

// v2 — Commitments (F2), Proactive Pulse (F3), Style Mirror (F5), Forecast (F6)
let commitments = null, proactive = null, styleMirror = null, forecast = null;
try { commitments = require('./server/commitments'); }
catch (e) { console.warn('⚠️  Commitments module not available:', e.message); }
try { proactive = require('./server/proactive'); }
catch (e) { console.warn('⚠️  Proactive module not available:', e.message); }
try { styleMirror = require('./server/style-mirror'); }
catch (e) { console.warn('⚠️  Style-mirror module not available:', e.message); }
try { forecast = require('./server/forecast'); }
catch (e) { console.warn('⚠️  Forecast module not available:', e.message); }

// Configuration
const PORT = process.env.PORT || 3001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

if (!OPENAI_API_KEY) {
    console.error('❌ ERROR: OPENAI_API_KEY NOT FOUND IN .ENV FILE');
}
if (!GEMINI_API_KEY) {
    console.warn('⚠️  GEMINI_API_KEY not set — slide image generation will be disabled.');
}
if (!GOOGLE_CLIENT_ID) {
    console.warn('⚠️  GOOGLE_CLIENT_ID not set — Google Calendar integration will be disabled.');
}

// ============================================
// CORS — Fase 2 (Android-ready)
// ============================================
// En desarrollo, ALLOWED_ORIGINS no se setea → CORS abierto a '*'.
// En producción, define ALLOWED_ORIGINS=https://gunter.tudominio.com,https://otro.com
// Para TWA / WebView Android, los orígenes posibles son:
//   - https://<tu-dominio>      (TWA cuando el manifest está en HTTPS público)
//   - 'null'                    (WebView puro / file:// — caso raro pero existe)
//   - https://localhost         (testing local)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

function buildCorsHeaders(reqOrigin) {
    let allowOrigin = '*';
    if (ALLOWED_ORIGINS.length > 0) {
        // Allowlist mode: solo origenes en la lista
        if (reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin)) {
            allowOrigin = reqOrigin;
        } else if (ALLOWED_ORIGINS.includes('*')) {
            allowOrigin = '*';
        } else {
            // Origen no permitido — devolvemos el primero como hint pero el
            // browser rechazará igual. Útil para debug.
            allowOrigin = ALLOWED_ORIGINS[0];
        }
    }
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    };
}

// Compatibilidad con código existente que aún usa `corsHeaders` directo
// (se mantiene como objeto wildcard para los pocos lugares estáticos).
const corsHeaders = buildCorsHeaders(null);

// Configuration for large file uploads.
// 200 MB accommodates 2h+ recordings at typical bitrates; individual
// Whisper chunks stay under 25 MB (API limit) and are far smaller (~500 KB)
// when produced by the rolling MediaRecorder.
const MAX_BODY_SIZE = 200 * 1024 * 1024;

// Create server
const server = http.createServer(async (req, res) => {
    // CORS dinámico per-request (respeta ALLOWED_ORIGINS o cae a '*')
    const reqOrigin = req.headers.origin || null;
    const resCors = buildCorsHeaders(reqOrigin);

    // Handle preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, resCors);
        res.end();
        return;
    }

    // Add CORS headers a TODA respuesta
    Object.keys(resCors).forEach(key => {
        res.setHeader(key, resCors[key]);
    });

    const parsedUrl = url.parse(req.url, true);
    console.log(`🌐 [${new Date().toISOString()}] ${req.method} ${parsedUrl.pathname}${reqOrigin ? ' (from ' + reqOrigin + ')' : ''}`);

    // ===== /api/health — Healthcheck para hosting + smoke pre-APK =====
    // Devuelve estado de cada subsistema + si hay key configurada (sin exponerla).
    if (parsedUrl.pathname === '/api/health' && req.method === 'GET') {
        const health = {
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            version: '2.0.0',
            services: {
                openai:        !!OPENAI_API_KEY,
                gemini:        !!GEMINI_API_KEY,
                google_oauth:  !!GOOGLE_CLIENT_ID,
                whatsapp:      !!wa,
                knowledge:     !!knowledge,
                premium_intel: !!premiumIntel,
                commitments:   !!commitments,
                proactive:     !!proactive,
                style_mirror:  !!styleMirror,
                forecast:      !!forecast
            },
            cors: {
                allowedOrigins: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : ['*'],
                requestOrigin: reqOrigin
            },
            persistence: {
                dataDir:         require('fs').existsSync(require('path').join(__dirname, 'data')),
                whatsappDataDir: require('fs').existsSync(require('path').join(__dirname, 'whatsapp-data'))
            }
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(health, null, 2));
    }

    // Transcription endpoint
    if (parsedUrl.pathname === '/api/transcribe' && req.method === 'POST') {
        try {
            let body = [];
            let totalSize = 0;

            req.on('data', chunk => {
                totalSize += chunk.length;

                // Check if size exceeds limit
                if (totalSize > MAX_BODY_SIZE) {
                    req.connection.destroy();
                    return;
                }

                body.push(chunk);
            });

            req.on('end', () => {
                if (totalSize > MAX_BODY_SIZE) {
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: `File too large. Maximum size is ${MAX_BODY_SIZE / (1024 * 1024)} MB. Received ${(totalSize / (1024 * 1024)).toFixed(2)} MB.`
                    }));
                    return;
                }

                body = Buffer.concat(body);

                // Forward to OpenAI
                const options = {
                    hostname: 'api.openai.com',
                    path: '/v1/audio/transcriptions',
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                        'Content-Type': req.headers['content-type'],
                        'Content-Length': body.length
                    }
                };

                console.log(`🎙️ Forwarding transcription request to OpenAI (${(body.length / (1024 * 1024)).toFixed(2)} MB)...`);

                const apiReq = https.request(options, apiRes => {
                    let data = '';

                    apiRes.on('data', chunk => {
                        data += chunk;
                    });

                    apiRes.on('end', () => {
                        console.log(`📥 OpenAI response status: ${apiRes.statusCode}`);
                        if (apiRes.statusCode !== 200) {
                            console.error(`❌ OpenAI Error: ${data}`);
                        }
                        res.writeHead(apiRes.statusCode, { 'Content-Type': 'text/plain' });
                        res.end(data);
                    });
                });

                apiReq.on('error', error => {
                    console.error('API Error:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                });

                apiReq.write(body);
                apiReq.end();
            });

        } catch (error) {
            console.error('Server Error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // Google OAuth status + client id delivery
    if (parsedUrl.pathname === '/api/google/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            configured: !!GOOGLE_CLIENT_ID,
            clientId: GOOGLE_CLIENT_ID || null,
            scope: 'https://www.googleapis.com/auth/calendar'
        }));
        return;
    }

    // Gemini health endpoint (tells client whether image generation is available)
    if (parsedUrl.pathname === '/api/gemini-status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ available: !!GEMINI_API_KEY }));
        return;
    }

    // Gemini text generation (used to plan the deck)
    if (parsedUrl.pathname === '/api/gemini-text' && req.method === 'POST') {
        if (!GEMINI_API_KEY) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'GEMINI_API_KEY not configured on server' }));
            return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            let payload;
            try { payload = JSON.parse(body); } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                return;
            }
            const model = payload.model || 'gemini-2.0-flash-exp';
            const apiBody = {
                contents: [{ role: 'user', parts: [{ text: payload.prompt || '' }] }],
                generationConfig: {
                    temperature: payload.temperature ?? 0.4,
                    maxOutputTokens: payload.maxTokens ?? 2400,
                    responseMimeType: payload.responseMimeType || 'application/json'
                }
            };
            const data = JSON.stringify(apiBody);
            const options = {
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            };
            const apiReq = https.request(options, apiRes => {
                let out = '';
                apiRes.on('data', c => { out += c; });
                apiRes.on('end', () => {
                    res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
                    res.end(out);
                });
            });
            apiReq.on('error', err => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            });
            apiReq.write(data); apiReq.end();
        });
        return;
    }

    // Gemini image generation (Nano Banana / gemini-2.5-flash-image)
    if (parsedUrl.pathname === '/api/gemini-image' && req.method === 'POST') {
        if (!GEMINI_API_KEY) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'GEMINI_API_KEY not configured on server' }));
            return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            let payload;
            try { payload = JSON.parse(body); } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                return;
            }
            const model = payload.model || 'gemini-2.5-flash-image';
            const apiBody = {
                contents: [{ role: 'user', parts: [{ text: payload.prompt || '' }] }],
                generationConfig: {
                    responseModalities: ['IMAGE', 'TEXT']
                }
            };
            const data = JSON.stringify(apiBody);
            const options = {
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            };
            console.log(`🎨 Gemini image request (${payload.prompt?.slice(0, 60)}…)`);
            const apiReq = https.request(options, apiRes => {
                let out = '';
                apiRes.on('data', c => { out += c; });
                apiRes.on('end', () => {
                    if (apiRes.statusCode !== 200) {
                        console.error(`❌ Gemini image error (${apiRes.statusCode}): ${out.slice(0, 400)}`);
                        res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
                        res.end(out);
                        return;
                    }
                    // Extract the first inline image from the response and return as data URL
                    try {
                        const parsed = JSON.parse(out);
                        const parts = parsed?.candidates?.[0]?.content?.parts || [];
                        const imgPart = parts.find(p => p.inlineData || p.inline_data);
                        if (!imgPart) {
                            res.writeHead(502, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'No image returned from Gemini', raw: parsed }));
                            return;
                        }
                        const inline = imgPart.inlineData || imgPart.inline_data;
                        const mime = inline.mimeType || inline.mime_type || 'image/png';
                        const b64 = inline.data;
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ mimeType: mime, data: b64, dataUrl: `data:${mime};base64,${b64}` }));
                    } catch (e) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Failed to parse Gemini response: ' + e.message }));
                    }
                });
            });
            apiReq.on('error', err => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            });
            apiReq.write(data); apiReq.end();
        });
        return;
    }

    // ========== TTS (humanized voices via OpenAI) ==========
    if (parsedUrl.pathname === '/api/tts' && req.method === 'POST') {
        if (!OPENAI_API_KEY) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'OPENAI_API_KEY missing' }));
            return;
        }
        let body = '';
        req.on('data', c => { body += c.toString(); });
        req.on('end', async () => {
            try {
                const { text, voice, speed, model } = JSON.parse(body || '{}');
                if (!text) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'text requerido' }));
                    return;
                }
                const openai = require('./server/openai-client');
                const buf = await openai.synthesizeSpeech({
                    text, voice: voice || 'alloy',
                    speed: typeof speed === 'number' ? speed : 1.0,
                    model: model || 'tts-1-hd'
                });
                res.writeHead(200, {
                    'Content-Type': 'audio/mpeg',
                    'Content-Length': buf.length,
                    'Cache-Control': 'no-store'
                });
                res.end(buf);
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Document extraction (receipts / invoices) via Gemini Vision
    if (parsedUrl.pathname === '/api/document-extract' && req.method === 'POST') {
        if (!GEMINI_API_KEY) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'GEMINI_API_KEY not configured on server' }));
            return;
        }

        // Simple in-memory rate limit: 20 req/min per remote IP
        const ip = req.socket.remoteAddress || 'unknown';
        if (!global.__docExtractCounter) global.__docExtractCounter = new Map();
        const now = Date.now();
        const bucket = global.__docExtractCounter.get(ip) || { count: 0, resetAt: now + 60_000 };
        if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + 60_000; }
        bucket.count++;
        global.__docExtractCounter.set(ip, bucket);
        if (bucket.count > 20) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Rate limit: 20 extracciones por minuto.' }));
            return;
        }

        const chunks = [];
        let totalSize = 0;
        const MAX = 15 * 1024 * 1024; // 15 MB JSON (imagen base64 ≤12 MB)

        req.on('data', c => {
            totalSize += c.length;
            if (totalSize > MAX) { req.connection.destroy(); return; }
            chunks.push(c);
        });

        req.on('end', () => {
            if (totalSize > MAX) {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Imagen demasiado grande (>12 MB).' }));
                return;
            }

            let payload;
            try {
                payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'JSON inválido' }));
                return;
            }
            if (!payload.image || !payload.mimeType) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Faltan campos image/mimeType' }));
                return;
            }

            const hint = payload.hint || 'auto';
            const locale = payload.locale || 'es-MX';
            const prompt = buildDocExtractPrompt(hint, locale);

            const apiBody = {
                contents: [{
                    role: 'user',
                    parts: [
                        { text: prompt },
                        { inline_data: { mime_type: payload.mimeType, data: payload.image } }
                    ]
                }],
                generationConfig: {
                    temperature: 0,
                    maxOutputTokens: 2048,
                    responseMimeType: 'application/json'
                }
            };
            const data = JSON.stringify(apiBody);
            const model = 'gemini-2.5-flash';
            const options = {
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            };

            const startedAt = Date.now();
            console.log(`📄 Document extract request (${(totalSize / 1024).toFixed(0)} KB, hint=${hint})…`);
            const apiReq = https.request(options, apiRes => {
                let out = '';
                apiRes.on('data', c => { out += c; });
                apiRes.on('end', () => {
                    const durationMs = Date.now() - startedAt;
                    if (apiRes.statusCode !== 200) {
                        console.error(`❌ Gemini doc extract error (${apiRes.statusCode})`);
                        res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
                        res.end(out);
                        return;
                    }
                    try {
                        const parsed = JSON.parse(out);
                        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        let extracted;
                        try { extracted = JSON.parse(text); }
                        catch {
                            const m = text.match(/\{[\s\S]*\}/);
                            extracted = m ? JSON.parse(m[0]) : null;
                        }
                        if (!extracted) {
                            res.writeHead(422, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({
                                error: 'Gemini respondió pero el JSON no es parseable',
                                raw: text.slice(0, 800)
                            }));
                            return;
                        }
                        console.log(`✅ Document extracted in ${durationMs}ms`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: true, extracted, model, durationMs }));
                    } catch (e) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Parse error: ' + e.message }));
                    }
                });
            });
            apiReq.on('error', err => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            });
            apiReq.write(data); apiReq.end();
        });
        return;
    }

    // ========== WHATSAPP ENDPOINTS ==========
    if (parsedUrl.pathname.startsWith('/api/whatsapp/')) {
        if (!wa || !waStore) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'WhatsApp module not loaded on server' }));
            return;
        }
        const sub = parsedUrl.pathname.slice('/api/whatsapp/'.length);

        // GET /api/whatsapp/status
        if (sub === 'status' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(wa.getStatus()));
            return;
        }

        // GET /api/whatsapp/qr
        if (sub === 'qr' && req.method === 'GET') {
            const q = wa.getQR();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(q));
            return;
        }

        // POST /api/whatsapp/connect
        if (sub === 'connect' && req.method === 'POST') {
            wa.start().catch(e => console.error('[wa] start error:', e));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, ...wa.getStatus() }));
            return;
        }

        // POST /api/whatsapp/disconnect
        if (sub === 'disconnect' && req.method === 'POST') {
            wa.disconnect().then(() => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            }).catch(e => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            });
            return;
        }

        // GET /api/whatsapp/messages?limit=50
        if (sub === 'messages' && req.method === 'GET') {
            const limit = Math.min(200, parseInt(parsedUrl.query.limit || '50', 10));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ messages: waStore.getRecentMessages(limit) }));
            return;
        }

        // POST /api/whatsapp/send  { to, text }
        if (sub === 'send' && req.method === 'POST') {
            let body = '';
            req.on('data', c => { body += c.toString(); });
            req.on('end', async () => {
                try {
                    const { to, text } = JSON.parse(body);
                    if (!to || !text) throw new Error('to y text son obligatorios');
                    await wa.sendMessage(to, text);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // GET /api/whatsapp/personality
        if (sub === 'personality' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(waPersonality.get()));
            return;
        }
        // POST /api/whatsapp/personality  { voiceStyle, personalityMode, personalityIntensity, userName, timezone }
        if (sub === 'personality' && req.method === 'POST') {
            let body = '';
            req.on('data', c => { body += c.toString(); });
            req.on('end', () => {
                try {
                    const patch = JSON.parse(body || '{}');
                    const next = waPersonality.set(patch);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(next));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // GET /api/whatsapp/memory — lista de contactos
        if (sub === 'memory' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ contacts: waMemory.listContacts() }));
            return;
        }
        // GET /api/whatsapp/memory/:phone — contexto completo
        if (sub.startsWith('memory/') && req.method === 'GET') {
            const phone = sub.slice('memory/'.length);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(waMemory.getFullContact(phone) || null));
            return;
        }
        // DELETE /api/whatsapp/memory/:phone
        if (sub.startsWith('memory/') && req.method === 'DELETE') {
            const phone = sub.slice('memory/'.length);
            waMemory.forget(phone);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // POST /api/whatsapp/state — mirror del state del browser
        if (sub === 'state' && req.method === 'POST') {
            let body = '';
            req.on('data', c => { body += c.toString(); });
            req.on('end', () => {
                try {
                    const state = JSON.parse(body || '{}');
                    const next = waMirror.set(state);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, updatedAt: next.updatedAt }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // GET /api/whatsapp/sync-pending
        if (sub === 'sync-pending' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ pending: waStore.getPendingSync() }));
            return;
        }

        // POST /api/whatsapp/sync-claim  { ids: [...] }
        if (sub === 'sync-claim' && req.method === 'POST') {
            let body = '';
            req.on('data', c => { body += c.toString(); });
            req.on('end', () => {
                try {
                    const { ids } = JSON.parse(body);
                    const claimed = waStore.claimSync(ids || []);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ claimed }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown WhatsApp endpoint' }));
        return;
    }

    // Chat completions endpoint
    // ============================================
    // KNOWLEDGE - Project memory shared with WhatsApp (Fase 11)
    // ============================================
    if (parsedUrl.pathname.startsWith('/api/knowledge') && knowledge) {
        const sub = parsedUrl.pathname.slice('/api/knowledge'.length).replace(/^\//, '');

        // POST /api/knowledge/sync — recibe snapshot completo desde browser
        if (sub === 'sync' && req.method === 'POST') {
            let body = '';
            req.on('data', c => { body += c.toString(); });
            req.on('end', () => {
                try {
                    const snap = JSON.parse(body);
                    const result = knowledge.putSnapshot(snap);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // GET /api/knowledge/stats
        if (sub === 'stats' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(knowledge.stats()));
            return;
        }

        // GET /api/knowledge/projects
        if (sub === 'projects' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ projects: knowledge.listProjects() }));
            return;
        }

        // GET /api/knowledge/project/:id
        if (sub.startsWith('project/') && req.method === 'GET') {
            const id = decodeURIComponent(sub.slice('project/'.length));
            const p = knowledge.getProject(id);
            if (!p) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Project not found' }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ project: p }));
            return;
        }

        // GET /api/knowledge/summary/:id?force=1
        if (sub.startsWith('summary/') && req.method === 'GET') {
            const id = decodeURIComponent(sub.slice('summary/'.length));
            const force = parsedUrl.query.force === '1' || parsedUrl.query.force === 'true';
            knowledge.summarizeProject(id, { force }).then(s => {
                if (!s) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Project not found' }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ summary: s }));
            }).catch(err => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            });
            return;
        }

        // POST /api/knowledge/search  { query, scope, projectId, limit }
        if (sub === 'search' && req.method === 'POST') {
            let body = '';
            req.on('data', c => { body += c.toString(); });
            req.on('end', () => {
                try {
                    const { query, scope, projectId, limit } = JSON.parse(body || '{}');
                    const results = knowledge.runSearch(query || '', { scope, projectId, limit });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ results }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // POST /api/knowledge/resolve  { query, contactId }
        if (sub === 'resolve' && req.method === 'POST') {
            let body = '';
            req.on('data', c => { body += c.toString(); });
            req.on('end', () => {
                try {
                    const { query, contactId } = JSON.parse(body || '{}');
                    const r = knowledge.resolveProject(query || '', { contactId: contactId || null });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(r));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
    }

    // ============================================
    // PREMIUM INTELLIGENCE - dispatcher (Sprint B)
    // ============================================
    if (parsedUrl.pathname === '/api/premium-intel' && req.method === 'POST' && premiumIntel) {
        let body = '';
        req.on('data', c => { body += c.toString(); });
        req.on('end', () => {
            let payload;
            try { payload = JSON.parse(body || '{}'); }
            catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, warnings: ['invalid-json'] }));
            }
            const { action, params } = payload;
            if (!action) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, warnings: ['action-required'] }));
            }
            premiumIntel.dispatch(action, params || {})
                .then(result => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                })
                .catch(err => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, warnings: [err.message] }));
                });
        });
        return;
    }
    if (parsedUrl.pathname === '/api/premium-intel/actions' && req.method === 'GET' && premiumIntel) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ actions: premiumIntel.listActions() }));
    }

    // ============================================
    // v2 — COMMITMENTS (F2) — promesas y cumplimiento
    // ============================================
    if (parsedUrl.pathname === '/api/commitments' && req.method === 'POST' && commitments) {
        let body = '';
        req.on('data', c => { body += c.toString(); });
        req.on('end', async () => {
            try {
                const { op, params = {} } = JSON.parse(body || '{}');
                let result;
                switch (op) {
                    case 'ingest':         result = await commitments.ingestText(params); break;
                    case 'reconcile':      result = await commitments.reconcile(params.event || {}); break;
                    case 'list':           result = { items: commitments.listAll(params) }; break;
                    case 'stats':          result = commitments.statsAll(); break;
                    case 'mark_fulfilled': result = commitments.markFulfilled(params.id, params.note || ''); break;
                    case 'mark_cancelled': result = commitments.markCancelled(params.id, params.reason || ''); break;
                    case 'add_manual':     result = commitments.addManual(params); break;
                    case 'remove':         result = { ok: commitments.remove(params.id) }; break;
                    case 'clear':          result = { ok: commitments.clear() }; break;
                    default:
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, warnings: ['unknown-op:' + op] }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, data: result }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, warnings: [err.message] }));
            }
        });
        return;
    }

    // ============================================
    // v2 — PROACTIVE PULSE (F3) — agente proactivo
    // ============================================
    if (parsedUrl.pathname === '/api/proactive' && req.method === 'POST' && proactive) {
        let body = '';
        req.on('data', c => { body += c.toString(); });
        req.on('end', async () => {
            try {
                const { op, params = {} } = JSON.parse(body || '{}');
                let result;
                switch (op) {
                    case 'tick':       result = await proactive.runTick(params); break;
                    case 'queue':      result = proactive.getQueue(params); break;
                    case 'dismiss':    result = proactive.dismiss(params.id, params.reason); break;
                    case 'snooze':     result = proactive.snooze(params.id, params.untilTs); break;
                    case 'act':        result = await proactive.act(params.id, params.action); break;
                    case 'stats':      result = proactive.stats(); break;
                    case 'clear':      result = { ok: proactive.clear() }; break;
                    default:
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, warnings: ['unknown-op:' + op] }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, data: result }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, warnings: [err.message] }));
            }
        });
        return;
    }

    // ============================================
    // v2 — STYLE MIRROR (F5) — modo espejo
    // ============================================
    if (parsedUrl.pathname === '/api/style-mirror' && req.method === 'POST' && styleMirror) {
        let body = '';
        req.on('data', c => { body += c.toString(); });
        req.on('end', async () => {
            try {
                const { op, params = {} } = JSON.parse(body || '{}');
                let result;
                switch (op) {
                    case 'profile':   result = await styleMirror.buildProfile(params); break;
                    case 'redact':    result = await styleMirror.redactInStyle(params); break;
                    case 'list':      result = styleMirror.listProfiles(); break;
                    case 'get':       result = styleMirror.getProfile(params.contactKey); break;
                    case 'remove':    result = { ok: styleMirror.removeProfile(params.contactKey) }; break;
                    case 'clear':     result = { ok: styleMirror.clear() }; break;
                    default:
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, warnings: ['unknown-op:' + op] }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, data: result }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, warnings: [err.message] }));
            }
        });
        return;
    }

    // ============================================
    // v2 — FORECAST (F6) — predicción de proyectos
    // ============================================
    if (parsedUrl.pathname === '/api/forecast' && req.method === 'POST' && forecast) {
        let body = '';
        req.on('data', c => { body += c.toString(); });
        req.on('end', async () => {
            try {
                const { op, params = {} } = JSON.parse(body || '{}');
                let result;
                switch (op) {
                    case 'project':   result = await forecast.forecastProject(params); break;
                    case 'all':       result = await forecast.forecastAll(params); break;
                    case 'history':   result = forecast.getHistory(params.projectId); break;
                    case 'clear':     result = { ok: forecast.clear() }; break;
                    default:
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, warnings: ['unknown-op:' + op] }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, data: result }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, warnings: [err.message] }));
            }
        });
        return;
    }

    // ============================================
    // EMBEDDINGS - text-embedding-3-small (Fase 4)
    // ============================================
    if (parsedUrl.pathname === '/api/embeddings' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            let payload;
            try { payload = JSON.parse(body || '{}'); }
            catch { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }

            const input = payload.input;
            if (!input || (Array.isArray(input) && input.length === 0)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Missing input (string or array of strings)' }));
            }

            const upstream = JSON.stringify({
                model: payload.model || 'text-embedding-3-small',
                input,
                encoding_format: 'float'
            });

            const options = {
                hostname: 'api.openai.com',
                path: '/v1/embeddings',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(upstream)
                }
            };

            const apiReq = https.request(options, apiRes => {
                let data = '';
                apiRes.on('data', chunk => { data += chunk; });
                apiRes.on('end', () => {
                    res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
                    res.end(data);
                });
            });
            apiReq.on('error', error => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            });
            apiReq.write(upstream);
            apiReq.end();
        });
        return;
    }

    if (parsedUrl.pathname === '/api/chat' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            const options = {
                hostname: 'api.openai.com',
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            };

            const apiReq = https.request(options, apiRes => {
                let data = '';

                apiRes.on('data', chunk => {
                    data += chunk;
                });

                apiRes.on('end', () => {
                    res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
                    res.end(data);
                });
            });

            apiReq.on('error', error => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            });

            apiReq.write(body);
            apiReq.end();
        });
        return;
    }

    // Static file serving
    let filePath = path.join(__dirname, parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);
    const extname = String(path.extname(filePath)).toLowerCase();
    const baseName = path.basename(filePath);

    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js':   'application/javascript; charset=utf-8',
        '.mjs':  'application/javascript; charset=utf-8',
        '.css':  'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.webmanifest': 'application/manifest+json; charset=utf-8',
        '.png':  'image/png',
        '.jpg':  'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif':  'image/gif',
        '.svg':  'image/svg+xml',
        '.webp': 'image/webp',
        '.ico':  'image/x-icon',
        '.wav':  'audio/wav',
        '.mp3':  'audio/mpeg',
        '.mp4':  'video/mp4',
        '.webm': 'video/webm',
        '.woff': 'font/woff',
        '.woff2':'font/woff2',
        '.ttf':  'font/ttf',
        '.eot':  'application/vnd.ms-fontobject',
        '.otf':  'font/otf',
        '.wasm': 'application/wasm',
        '.txt':  'text/plain; charset=utf-8',
        '.xml':  'application/xml; charset=utf-8'
    };

    let contentType = mimeTypes[extname] || 'application/octet-stream';

    // === Fase 2 (Android-ready): casos especiales ===
    // Service Worker: DEBE servirse como text/javascript o el browser lo rechaza.
    // Manifest: algunos navegadores Android prefieren application/manifest+json.
    if (baseName === 'service-worker.js' || baseName === 'sw.js') {
        contentType = 'application/javascript; charset=utf-8';
    }
    if (baseName === 'manifest.json' || baseName === 'manifest.webmanifest') {
        contentType = 'application/manifest+json; charset=utf-8';
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
            } else {
                res.writeHead(500);
                res.end(`Sorry, check with the site admin for error: ${error.code} ..\n`);
            }
        } else {
            const headers = { 'Content-Type': contentType };
            // Service Worker NO se cachea (bug conocido de PWAs viejas)
            if (baseName === 'service-worker.js' || baseName === 'sw.js') {
                headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
                // Allow scope full
                headers['Service-Worker-Allowed'] = '/';
            }
            res.writeHead(200, headers);
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════');
    console.log('║  🐧 GUNTER PROXY SERVER');
    console.log('╠════════════════════════════════════════════════');
    console.log(`║  Running on: http://localhost:${PORT}`);
    console.log('║  Endpoints:');
    console.log('║    POST /api/transcribe    - Audio transcription (Whisper)');
    console.log('║    POST /api/chat          - Chat completions (OpenAI)');
    console.log('║    POST /api/tts           - Text-to-speech humanizado (OpenAI)');
    console.log('║    POST /api/embeddings    - Vector embeddings (text-embedding-3-small)');
    console.log('║    *    /api/knowledge/*   - Project memory shared with WhatsApp');
    console.log('║    POST /api/premium-intel - Premium intelligence (planner, summary, urgency, etc.)');
    console.log('║    POST /api/gemini-text   - Gemini text generation');
    console.log('║    POST /api/gemini-image    - Gemini image generation');
    console.log('║    POST /api/document-extract- Receipts / invoices (Gemini Vision)');
    console.log('║    GET  /api/gemini-status   - Gemini availability check');
    console.log('║    GET  /api/google/status   - Google OAuth availability');
    console.log('║    *    /api/whatsapp/*      - WhatsApp bridge (Baileys + QR)');
    console.log('║   ── v2 — Funciones avanzadas ──');
    console.log('║    POST /api/commitments     - F2: Detector de compromisos cruzados');
    console.log('║    POST /api/proactive       - F3: Pulso proactivo (engine + queue)');
    console.log('║    POST /api/style-mirror    - F5: Modo espejo (clonado de estilo)');
    console.log('║    POST /api/forecast        - F6: Forecast probabilístico');
    console.log('╚════════════════════════════════════════════════');
    console.log('');
});

// Increase timeouts for large file uploads (10 minutes)
server.timeout = 600000; // 10 minutes
server.keepAliveTimeout = 610000; // Slightly longer than timeout
server.headersTimeout = 620000; // Slightly longer than keepAliveTimeout

console.log('⏱️  Server timeouts configured for large file uploads (10 min)');

// ---------- Helpers ----------
function buildDocExtractPrompt(hint, locale) {
    const hintDesc = {
        receipt:  'Es un recibo de servicio (luz, gas, internet, agua, teléfono…)',
        invoice:  'Es una factura comercial',
        ticket:   'Es un ticket de compra',
        auto:     'Determina automáticamente el tipo'
    }[hint] || 'Determina automáticamente el tipo';

    return `Eres un extractor de datos de recibos y facturas. Idioma: ${locale}. ${hintDesc}.

Analiza la imagen adjunta y extrae EXCLUSIVAMENTE los campos del schema JSON siguiente.

REGLAS CRÍTICAS:
- Nunca inventes datos. Si un campo no aparece legible, usa null.
- Fechas: ISO 8601 estricto (YYYY-MM-DD). Convierte formatos DD/MM/YYYY o DD-MM-YYYY a ISO.
- Valores numéricos: usa punto como separador decimal, sin separador de miles. Si aparece "$127.900" en español latinoamericano, el valor es 127900.
- Moneda: código ISO 4217 en mayúsculas (COP, MXN, USD, ARS, EUR, PEN, CLP...). Si ves "$" sin contexto, infiere por la empresa/país visible, o deja null.
- confidence: valor 0.0–1.0 por cada campo y uno "overall" (promedio ponderado).
- warnings: lista strings en español con banderas de baja confianza o ambigüedades detectadas.
- Responde ÚNICAMENTE con JSON válido. Sin texto antes ni después. Sin markdown.

SCHEMA OBLIGATORIO:
{
  "tipo": "recibo" | "factura" | "ticket" | "boleta" | "otro",
  "empresa": {
    "nombre": "string | null",
    "nit": "string | null",
    "contacto": { "telefono": "string|null", "email": "string|null", "web": "string|null" }
  },
  "valor": {
    "total": number | null,
    "moneda": "string | null",
    "subtotal": number | null,
    "impuestos": number | null,
    "texto_original": "string | null"
  },
  "fecha_emision": "YYYY-MM-DD | null",
  "fecha_vencimiento": "YYYY-MM-DD | null",
  "referencia": {
    "numero_factura": "string | null",
    "numero_cliente": "string | null",
    "codigo_pago": "string | null",
    "periodo": "string | null"
  },
  "conceptos": [ { "descripcion": "string", "valor": number } ],
  "metodo_pago_sugerido": "PSE | transferencia | efectivo | tarjeta | null",
  "resumen": "string breve en ${locale} de una frase",
  "confidence": {
    "overall": 0.0,
    "empresa": 0.0,
    "valor": 0.0,
    "fecha_vencimiento": 0.0,
    "referencia": 0.0
  },
  "warnings": []
}`;
}
