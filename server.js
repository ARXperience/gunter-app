// =============================================
// GUNTER APP - Simple Proxy Server for OpenAI API
// Solves CORS issues for audio transcription
// =============================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Log ring buffer — captura console.* para el panel admin (instalar ANTES
// de cargar módulos para registrar también sus warnings de arranque).
const logRing = require('./server/log-ring');
logRing.install();

// Auth — usuarios, sesiones y guard de /api/*
const auth = require('./server/auth');

// Multi-tenant — el usuario de la sesión viaja por AsyncLocalStorage
// a todos los módulos (cada usuario tiene su carpeta en data/users/)
const userContext = require('./server/user-context');

// v42 — Gemini como motor LLM principal (chat, transcripción, embeddings)
// cuando no hay OPENAI_API_KEY. Ver server/gemini-client.js.
const geminiClient = require('./server/gemini-client');

// v46 — Respaldo gratuito cuando Gemini agota su cuota diaria:
// Groq / OpenRouter / Mistral (con key gratis) + Pollinations (sin key).
const fallbackLLM = require('./server/fallback-llm-client');

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
let commitments = null, proactive = null, styleMirror = null, forecast = null, jobs = null, push = null, mobilePushScheduler = null;
try { commitments = require('./server/commitments'); }
catch (e) { console.warn('⚠️  Commitments module not available:', e.message); }
try { proactive = require('./server/proactive'); }
catch (e) { console.warn('⚠️  Proactive module not available:', e.message); }
try { styleMirror = require('./server/style-mirror'); }
catch (e) { console.warn('⚠️  Style-mirror module not available:', e.message); }
try { forecast = require('./server/forecast'); }
catch (e) { console.warn('⚠️  Forecast module not available:', e.message); }
try { jobs = require('./server/jobs'); }
catch (e) { console.warn('⚠️  Durable jobs module not available:', e.message); }
try { push = require('./server/push'); }
catch (e) { console.warn('⚠️  Web Push module not available:', e.message); }
try { mobilePushScheduler = require('./server/push/mobile-scheduler'); }
catch (e) { console.warn('⚠️  Mobile push scheduler not available:', e.message); }

// Plan Maestro v2 — Control Plane incremental (contratos, flags, entitlements,
// nodos, skills, verificación y operaciones). Vive aislado de las rutas legacy.
let controlPlane = null;
try { controlPlane = require('./server/control-plane'); }
catch (e) { console.warn('⚠️  Control Plane module not available:', e.message); }
const localBrain = require('./server/local-brain');

// Etapa 3 — Actions dispatcher (control unificado de features)
let actions = null;
try { actions = require('./server/actions/dispatcher'); }
catch (e) { console.warn('⚠️  Actions dispatcher not available:', e.message); }

// Modo Tutor — biblioteca curada + sesiones
let tutor = null;
try { tutor = require('./server/tutor'); }
catch (e) { console.warn('⚠️  Tutor module not available:', e.message); }

// Configuration
const PORT = process.env.PORT || 3001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const OWNER_PHONE = process.env.OWNER_PHONE || null;   // Etapa 3 — owner autorizado por WA

if (!OPENAI_API_KEY) {
    console.warn('⚠️  OPENAI_API_KEY not set — Gunter will use any configured fallback provider.');
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

function defaultOriginAllowed(reqOrigin, req) {
    if (!reqOrigin || !req) return !reqOrigin;
    const forwardedProto = process.env.TRUST_PROXY === 'true'
        ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
        : '';
    const protocol = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
    return reqOrigin === `${protocol}://${req.headers.host}`;
}

function isOriginAllowed(reqOrigin, req) {
    if (!reqOrigin) return true;
    if (ALLOWED_ORIGINS.includes('*')) return true;
    if (ALLOWED_ORIGINS.length > 0) return ALLOWED_ORIGINS.includes(reqOrigin);
    return defaultOriginAllowed(reqOrigin, req);
}

function buildCorsHeaders(reqOrigin, req) {
    const allowOrigin = reqOrigin && isOriginAllowed(reqOrigin, req)
        ? (ALLOWED_ORIGINS.includes('*') ? '*' : reqOrigin)
        : null;
    const headers = {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    };
    if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
    return headers;
}

// Compatibilidad con código existente que aún usa `corsHeaders` directo
// (se mantiene como objeto wildcard para los pocos lugares estáticos).
const corsHeaders = buildCorsHeaders(null);

// Configuration for large file uploads.
// 200 MB accommodates 2h+ recordings at typical bitrates; individual
// Whisper chunks stay under 25 MB (API limit) and are far smaller (~500 KB)
// when produced by the rolling MediaRecorder.
const MAX_BODY_SIZE = 200 * 1024 * 1024;
const MAX_JSON_BODY_SIZE = 2 * 1024 * 1024;
const apiRateBuckets = new Map();
const EXPENSIVE_API_PATHS = new Set([
    '/api/chat', '/api/transcribe', '/api/tts', '/api/embeddings',
    '/api/gemini-text', '/api/gemini-image', '/api/document-extract',
    '/api/premium-intel', '/api/forecast', '/api/style-mirror'
]);

function checkApiRateLimit(req, pathname) {
    const windowMs = 60 * 1000;
    const max = EXPENSIVE_API_PATHS.has(pathname) ? 30 : 240;
    const forwarded = process.env.TRUST_PROXY === 'true'
        ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        : '';
    const actor = req.gunterUser?.id || forwarded || req.socket?.remoteAddress || 'unknown';
    const key = `${actor}|${EXPENSIVE_API_PATHS.has(pathname) ? pathname : 'general'}`;
    const now = Date.now();
    const current = apiRateBuckets.get(key);
    if (!current || now - current.startedAt >= windowMs) {
        apiRateBuckets.set(key, { count: 1, startedAt: now });
        return { allowed: true, remaining: max - 1 };
    }
    current.count += 1;
    if (apiRateBuckets.size > 10000) {
        for (const [bucketKey, value] of apiRateBuckets) {
            if (now - value.startedAt >= windowMs) apiRateBuckets.delete(bucketKey);
        }
    }
    return {
        allowed: current.count <= max,
        remaining: Math.max(0, max - current.count),
        retryAfter: Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1000))
    };
}

// Solo estos recursos forman parte de la aplicación web pública. El resto del
// repositorio contiene secretos, datos de usuarios y código del servidor.
const PUBLIC_FILES = new Set([
    'index.html', 'login.html', 'dashboard.html', 'day.html',
    'new-project.html', 'meeting.html', 'results.html', 'config.html',
    'admin.html', 'reset.html', 'manifest.json', 'service-worker.js'
]);
const PUBLIC_DIRS = new Set(['assets', 'js', 'styles']);
const LEGACY_PAGE_REDIRECTS = Object.freeze({
    '/chat.html': '/day.html#chat',
    '/tasks.html': '/day.html#tasks',
    '/calendar.html': '/day.html#events',
    '/meetings.html': '/dashboard.html',
    '/documents.html': '/day.html#documents',
    '/inbox.html': '/day.html#conversations'
});

const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': [
        "default-src 'self' https: data: blob:",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://accounts.google.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "connect-src 'self' https: wss:",
        "img-src 'self' https: data: blob:",
        "media-src 'self' https: data: blob:",
        "worker-src 'self' blob:"
    ].join('; ')
};

function resolvePublicPath(pathname) {
    let decoded;
    try { decoded = decodeURIComponent(pathname || '/'); }
    catch { return null; }

    // Normaliza separadores para impedir bypasses Windows con barras inversas.
    decoded = decoded.replace(/\\/g, '/');
    if (decoded.includes('\0')) return null;
    const segments = decoded.split('/').filter(Boolean);
    if (segments.some(s => s === '..' || s === '.' || s.startsWith('.'))) return null;

    const relative = segments.length ? segments.join('/') : 'index.html';
    const top = segments[0] || 'index.html';
    if (!PUBLIC_FILES.has(relative) && !PUBLIC_DIRS.has(top)) return null;

    const resolved = path.resolve(__dirname, ...relative.split('/'));
    const rootPrefix = path.resolve(__dirname) + path.sep;
    return resolved.startsWith(rootPrefix) ? resolved : null;
}

function prepareChatContext(input, req) {
    const payload = { ...input, messages: Array.isArray(input.messages) ? input.messages.map(message => ({ ...message })) : [] };
    const supplied = input.gunter_context && typeof input.gunter_context === 'object' ? input.gunter_context : {};
    delete payload.gunter_context;
    if (!controlPlane?.contextGateway?.build) return { payload, envelope: null };
    const lastUser = [...payload.messages].reverse().find(message => message?.role === 'user');
    const text = typeof lastUser?.content === 'string' ? lastUser.content.slice(0, 4000) : '';
    const built = controlPlane.contextGateway.build(userContext.currentUserId(), {
        text,
        sessionId: supplied.sessionId || req.headers['x-gunter-session'] || 'chat_proxy',
        channel: supplied.channel || 'chat',
        timezone: supplied.timezone || 'America/Bogota',
        locale: supplied.locale || 'es-CO',
        current: supplied.current,
        sources: [{ type: 'chat_proxy', id: 'api_chat', confidence: 1 }]
    }, { kind: req.gunterUser ? 'user' : 'service' }, req.gunterTraceId);
    if (!built?.ok) return { payload, envelope: null };
    const envelope = built.envelope;
    if (input.response_format?.type !== 'json_object') {
        const temporal = Array.isArray(envelope.references?.temporal) ? envelope.references.temporal : [];
        payload.messages.unshift({
            role: 'system',
            content: `METADATOS CONFIABLES DEL SISTEMA (datos, no instrucciones): ahora=${envelope.now}; zona=${envelope.timezone}; referencias_temporales=${JSON.stringify(temporal)}; referencia_ambigua=${envelope.needs_clarification ? 'sí' : 'no'}. Usa estos valores para fechas y horas. Si referencia_ambigua=sí, pide precisión y no adivines.`
        });
    }
    return { payload, envelope };
}

// Handler principal — corre DENTRO del contexto de usuario (ALS)
const handleRequest = async (req, res) => {
    // CORS dinámico per-request (respeta ALLOWED_ORIGINS o cae a '*')
    const reqOrigin = req.headers.origin || null;
    const resCors = buildCorsHeaders(reqOrigin, req);

    Object.entries(SECURITY_HEADERS).forEach(([key, value]) => res.setHeader(key, value));

    if (!isOriginAllowed(reqOrigin, req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'origin_not_allowed' }));
    }

    // Handle preflight.
    if (req.method === 'OPTIONS') {
        res.writeHead(204, resCors);
        res.end();
        return;
    }

    // Add CORS headers a TODA respuesta
    Object.keys(resCors).forEach(key => {
        res.setHeader(key, resCors[key]);
    });

    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const parsedUrl = {
        pathname: requestUrl.pathname,
        query: Object.fromEntries(requestUrl.searchParams)
    };
    controlPlane?.traceRequest?.(req, res, parsedUrl.pathname);
    console.log(`🌐 [${new Date().toISOString()}] ${req.method} ${parsedUrl.pathname}${reqOrigin ? ' (from ' + reqOrigin + ')' : ''}`);

    // Rechazo temprano para cuerpos declarados demasiado grandes. Audio usa
    // su límite específico; las APIs JSON no deben reservar cientos de MB.
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const declared = Number(req.headers['content-length'] || 0);
        const limit = parsedUrl.pathname === '/api/transcribe' ? MAX_BODY_SIZE : MAX_JSON_BODY_SIZE;
        if (Number.isFinite(declared) && declared > limit) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'payload_too_large', maxBytes: limit }));
        }
    }

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
                durable_jobs:  !!jobs,
                web_push:      !!push,
                control_plane: !!controlPlane,
                style_mirror:  !!styleMirror,
                forecast:      !!forecast,
                fallback_llm:  fallbackLLM.activeProviders().length > 0
            },
            mobileNotifications: {
                androidFcm: require('./server/push/mobile').isConfigured('fcm'),
                iosApns: require('./server/push/mobile').isConfigured('apns')
            },
            fallbackProviders: fallbackLLM.activeProviders(),
            cors: {
                allowedOrigins: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : ['*'],
                requestOrigin: reqOrigin
            },
            persistence: {
                dataDir:         require('fs').existsSync(process.env.GUNTER_DATA_DIR || require('path').join(__dirname, 'data')),
                whatsappDataDir: require('fs').existsSync(process.env.GUNTER_WHATSAPP_DATA_DIR || require('path').join(__dirname, 'whatsapp-data'))
            }
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(health, null, 2));
    }

    // ===== /api/auth/* — Registro, login, sesiones, admin =====
    if (parsedUrl.pathname.startsWith('/api/auth/')) {
        const sub = parsedUrl.pathname.slice('/api/auth/'.length).replace(/\/+$/, '');
        if (req.method === 'GET') {
            const result = auth.handle(sub, 'GET', parsedUrl.query, req);
            res.writeHead(result.status, { 'Content-Type': 'application/json', ...(result.headers || {}) });
            return res.end(JSON.stringify(result.body));
        }
        let body = '';
        req.on('data', c => { body += c.toString(); });
        req.on('end', () => {
            try {
                const parsed = body ? JSON.parse(body) : {};
                const result = auth.handle(sub, req.method, parsed, req);
                res.writeHead(result.status, { 'Content-Type': 'application/json', ...(result.headers || {}) });
                res.end(JSON.stringify(result.body));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'JSON inválido: ' + e.message }));
            }
        });
        return;
    }

    // ===== GUARD GLOBAL — todo /api/* (excepto health y auth) requiere sesión aprobada =====
    if (parsedUrl.pathname.startsWith('/api/')) {
        // Los runtimes Desktop/Mobile usan credencial de node exclusivamente en
        // heartbeat/pull/result. El resto conserva la sesión o service token.
        const nodeActor = controlPlane?.authenticateNodeRequest?.(req, parsedUrl.pathname);
        const denied = nodeActor ? null : auth.guard(req);
        if (denied) {
            res.writeHead(denied.code, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: denied.error, message: denied.message }));
        }
        const rate = checkApiRateLimit(req, parsedUrl.pathname);
        res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
        if (!rate.allowed) {
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(rate.retryAfter) });
            return res.end(JSON.stringify({ success: false, error: 'rate_limited', retryAfter: rate.retryAfter }));
        }
    }

    // ===== /api/control/* — Control Plane versionado del Plan Maestro =====
    if (controlPlane && parsedUrl.pathname.startsWith('/api/control/')) {
        await controlPlane.handle(req, res, parsedUrl.pathname, parsedUrl.query);
        return;
    }

    // Foundation-only privacy gate. All existing cloud implementations remain
    // untouched in AUTO/CLOUD; LOCAL and LOCAL_ONLY fail before request bodies
    // are consumed, so a prohibited cloud call cannot accidentally fall through.
    if (req.method === 'POST' && controlPlane) {
        const hybridKind = ({ '/api/chat': 'chat', '/api/transcribe': 'stt', '/api/tts': 'tts', '/api/embeddings': 'embeddings',
            '/api/gemini-text': 'chat', '/api/gemini-image': 'chat', '/api/document-extract': 'chat',
            '/api/premium-intel': 'chat', '/api/premium-intel/actions': 'chat',
            '/api/style-mirror': 'chat', '/api/forecast': 'chat', '/api/tutor': 'chat' })[parsedUrl.pathname];
        if (hybridKind) {
            const decision = controlPlane.modelRouter.resolveHybrid(hybridKind,
                controlPlane.settings.hybridStatus(userContext.currentUserId()),
                { ...req.gunterUser, userId: userContext.currentUserId() });
            if (!decision.ok) {
                res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                return res.end(JSON.stringify({ success: false, error: decision.code, code: decision.code,
                    message: 'El proveedor local aún no está instalado. Cambia a AUTO/CLOUD o instala uno en una fase posterior.' }));
            }
            if (decision.provider === 'local' && parsedUrl.pathname !== '/api/chat') {
                res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                return res.end(JSON.stringify({ success: false, error: 'LOCAL_ONLY_MODE', code: 'LOCAL_ONLY_MODE' }));
            }
            if (hybridKind === 'chat') req.gunterBrainProvider = decision.provider;
        }
    }

    if (parsedUrl.pathname === '/api/location/reverse' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const result = await require('./server/location').reverse(JSON.parse(body));
                res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                res.end(JSON.stringify(result));
            } catch (error) {
                res.writeHead(error instanceof SyntaxError ? 400 : error.status || 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                res.end(JSON.stringify({ error: error.status === 400 ? 'invalid_coordinates' : 'location_unavailable' }));
            }
        });
        return;
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

                // v42 — Sin OpenAI: transcripción via Gemini (mismo shape {text} de Whisper)
                if (!OPENAI_API_KEY) {
                    if (!geminiClient.hasKey()) {
                        res.writeHead(503, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: 'Sin proveedor de transcripción configurado' }));
                    }
                    const parsed = extractMultipartFile(body, req.headers['content-type']);
                    if (!parsed || !parsed.file || !parsed.file.data.length) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: 'No se encontró archivo de audio en el form-data' }));
                    }
                    // Gemini inline: máx ~14 MB de audio crudo por request
                    if (parsed.file.data.length > 14 * 1024 * 1024) {
                        res.writeHead(413, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: 'Chunk de audio muy grande para Gemini (máx 14 MB). Graba en fragmentos más cortos.' }));
                    }
                    console.log(`🎙️ Transcribiendo con Gemini (${(parsed.file.data.length / 1024).toFixed(0)} KB, ${parsed.file.mime})…`);
                    geminiClient.transcribeAudio(parsed.file.data, parsed.file.mime, parsed.language)
                        .catch(e => {
                            // v46 — respaldo: Groq Whisper (gratis con GROQ_API_KEY)
                            console.warn('[transcribe] Gemini falló — respaldo Groq:', e.message.slice(0, 100));
                            return fallbackLLM.transcribeAudio(parsed.file.data, parsed.file.mime, parsed.language);
                        })
                        .then(text => {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ text }));
                        })
                        .catch(e => {
                            console.error('❌ Transcripción sin proveedores:', e.message);
                            res.writeHead(502, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: e.message }));
                        });
                    return;
                }

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
            // Validar ANTES de llamar a Google — un prompt vacío quema cuota
            if (!payload.prompt || !String(payload.prompt).trim()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'prompt requerido' }));
                return;
            }
            // v42: los modelos 2.0 quedaron sin cuota free — default 2.5-flash
            const model = payload.model && !/gemini-(1\.5|2\.0)/.test(payload.model)
                ? payload.model : 'gemini-2.5-flash';
            const apiBody = {
                contents: [{ role: 'user', parts: [{ text: payload.prompt }] }],
                generationConfig: {
                    temperature: payload.temperature ?? 0.4,
                    maxOutputTokens: payload.maxTokens ?? 2400,
                    // sin thinking: la respuesta completa va al output
                    thinkingConfig: { thinkingBudget: 0 },
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
            // Validar ANTES de llamar a Google — un prompt vacío quemaba cuota
            if (!payload.prompt || !String(payload.prompt).trim()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'prompt requerido' }));
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

    // ========== TTS (voces humanas: OpenAI o Gemini TTS) ==========
    if (parsedUrl.pathname === '/api/tts' && req.method === 'POST') {
        // v43: sin OpenAI, la voz corre en Gemini TTS (voces neuronales free
        // tier) con cache en disco. Si Gemini falla (cuota del día agotada),
        // 503 → el cliente cae solo a la voz del navegador.
        if (!OPENAI_API_KEY) {
            if (!geminiClient.hasKey()) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'tts_unavailable', fallback: 'browser' }));
                return;
            }
            let body = '';
            req.on('data', c => { body += c.toString(); });
            req.on('end', async () => {
                try {
                    const { text, voice } = JSON.parse(body || '{}');
                    if (!text) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: 'text requerido' }));
                    }
                    const { buffer: buf, mime } = await ttsCachedSynthesize(String(text), String(voice || 'fable'));
                    res.writeHead(200, {
                        'Content-Type': mime,
                        'Content-Length': buf.length,
                        'Cache-Control': 'no-store'
                    });
                    res.end(buf);
                } catch (e) {
                    console.warn('⚠️ Gemini TTS falló (cliente usará voz del navegador):', e.message.slice(0, 150));
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'tts_unavailable', fallback: 'browser', detail: e.message.slice(0, 120) }));
                }
            });
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

        // El número puente es del sistema: solo el admin lo conecta/desconecta.
        // (req.gunterUser lo setea el guard; sin él = service token = nivel admin)
        if ((sub === 'connect' || sub === 'disconnect') && req.method === 'POST'
            && req.gunterUser && req.gunterUser.role !== 'admin') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'admin_only', message: 'Solo el administrador puede conectar o desconectar el WhatsApp del sistema.' }));
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
                    const { to, text, confirmed, source } = JSON.parse(body);
                    if (!to || !text) throw new Error('to y text son obligatorios');
                    if (confirmed !== true || !['user_click', 'manual', 'user_voice_confirmed'].includes(source)) {
                        throw new Error('explicit_send_confirmation_required');
                    }
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
    // GUNTER — DURABLE JOBS — recordatorios y seguimientos server-side
    // ============================================
    if (parsedUrl.pathname.startsWith('/api/push') && push) {
        if (req.method === 'GET' && parsedUrl.pathname === '/api/push/public-key') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, data: { publicKey: push.publicKey() } }));
        }
        if (req.method === 'GET' && parsedUrl.pathname === '/api/push/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, data: push.status() }));
        }
        if (req.method === 'POST') {
            let body = ''; let tooLarge = false;
            req.on('data', chunk => { body += chunk.toString(); if (body.length > 20_000) tooLarge = true; });
            req.on('end', async () => {
                try {
                    if (tooLarge) throw Object.assign(new Error('push_payload_too_large'), { status: 413 });
                    const value = body ? JSON.parse(body) : {};
                    let result;
                    if (parsedUrl.pathname === '/api/push/subscribe') result = push.subscribe(value, { deviceLabel: value.deviceLabel, userAgent: req.headers['user-agent'] });
                    else if (parsedUrl.pathname === '/api/push/unsubscribe') result = push.unsubscribe(value);
                    else if (parsedUrl.pathname === '/api/push/test') {
                        if (value.confirmed !== true) result = { ok: false, error: 'explicit_send_confirmation_required' };
                        else result = { ok: true, ...(await push.deliver({ title: 'Gunter está listo', body: 'Las alertas en segundo plano funcionan en este dispositivo.', tag: 'gunter-push-test', url: '/config.html#preferences' })) };
                    } else result = { ok: false, error: 'push_operation_not_found' };
                    res.writeHead(result.ok === false ? 400 : 200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: result.ok !== false, data: result.ok === false ? undefined : result, error: result.error }));
                } catch (error) {
                    res.writeHead(error.status || 400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, error: error.code || error.message }));
                }
            });
            return;
        }
    }
    if (parsedUrl.pathname === '/api/jobs' && req.method === 'POST' && jobs) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const { op, params = {} } = JSON.parse(body || '{}');
                let result;
                switch (op) {
                    case 'create':  result = jobs.create(params); break;
                    case 'list':    result = { items: jobs.list(params) }; break;
                    case 'get':     result = { job: jobs.get(params.id) }; break;
                    case 'cancel':  result = jobs.cancel(params.id); break;
                    case 'retry':   result = jobs.retry(params.id); break;
                    case 'run_due': result = await jobs.runDue(); break;
                    case 'stats':   result = jobs.stats(); break;
                    default:
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, error: 'unknown_op' }));
                }
                if (result?.ok === false) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, error: result.error || result.reason || 'job_operation_failed', data: result }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true, data: result }));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
        return;
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
    // TUTOR — biblioteca curada + sesiones
    // ============================================
    if (parsedUrl.pathname === '/api/tutor' && req.method === 'POST' && tutor) {
        // v50 — El Tutor 📚 es privilegio del admin; a otros usuarios se les
        // concede desde el panel (tutor-access). Service token pasa siempre.
        if (req.gunterUser && req.gunterUser.role !== 'admin' && !req.gunterUser.tutorAccess) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                success: false, error: 'tutor_not_granted',
                message: 'El modo Tutor no está habilitado para tu cuenta. Pídele acceso al administrador.'
            }));
        }
        let body = '';
        req.on('data', c => { body += c.toString(); });
        req.on('end', async () => {
            try {
                const { op, ...params } = JSON.parse(body || '{}');
                const result = await tutor.handle(op, params);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    // ACTIONS DISPATCHER (Etapa 3 — control unificado de features)
    // Usa el vocabulario compartido con WA. Un solo lugar para
    // toggle flags / query features / listar activas.
    // ============================================
    if (parsedUrl.pathname === '/api/actions' && req.method === 'POST' && actions) {
        let body = '';
        req.on('data', c => { body += c.toString(); });
        req.on('end', async () => {
            try {
                const { op = 'dispatch', text, flag, value, meta, flags } = JSON.parse(body || '{}');
                let result;
                switch (op) {
                    case 'dispatch':
                        // op principal: procesa texto libre desde el widget
                        result = await actions.dispatch({
                            text,
                            channel: 'browser',
                            identifier: reqOrigin || 'browser',
                            ownerPhone: OWNER_PHONE
                        });
                        break;
                    case 'get_state':
                        result = { state: actions.getState() };
                        break;
                    case 'set':
                        // Set directo (usado por el UI de Premium al toggle un switch)
                        actions.setDirect(flag, value, meta || { source: 'browser' });
                        result = { flag, value };
                        break;
                    case 'sync_from_browser':
                        actions.syncFromBrowser(flags || {});
                        result = { ok: true };
                        break;
                    case 'list_vocabulary':
                        result = { features: actions.vocabulary.listAll() };
                        break;
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

            // v42 — Sin OpenAI: embeddings via Gemini (1536 dims, shape OpenAI)
            if (!OPENAI_API_KEY) {
                if (!geminiClient.hasKey()) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Sin proveedor de embeddings configurado' }));
                }
                geminiClient.embedTexts(input)
                    .then(vectors => {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            object: 'list',
                            model: geminiClient.EMBED_MODEL,
                            data: vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })),
                            usage: {}
                        }));
                    })
                    .catch(e => {
                        console.error('❌ Gemini embeddings:', e.message);
                        res.writeHead(502, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    });
                return;
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

        req.on('end', async () => {
            let payload;
            try {
                payload = JSON.parse(body || '{}');
                if (!Array.isArray(payload.messages) || !payload.messages.length) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: { message: 'messages[] requerido' } }));
                }
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: { message: 'JSON inválido' } }));
            }
            const prepared = prepareChatContext(payload, req);
            payload = prepared.payload;
            body = JSON.stringify(payload);
            const contextHeaders = prepared.envelope ? {
                'X-Gunter-Context-Id': prepared.envelope.context_id,
                'X-Gunter-Trace-Id': prepared.envelope.trace_id
            } : {};
            if (req.gunterBrainProvider === 'local') {
                const controller = new AbortController();
                res.once('close', () => { if (!res.writableEnded) controller.abort(); });
                const localMessages = payload.messages;
                const invalidMessages = localMessages.length > 24 || localMessages.some(message =>
                    !['system', 'user', 'assistant'].includes(message?.role) ||
                    typeof message.content !== 'string' || message.content.length > 8000);
                const format = payload.response_format;
                const invalidFormat = format && (!['json_object', 'json_schema'].includes(format.type) ||
                    JSON.stringify(format).length > 8192);
                if (invalidMessages || invalidFormat) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, code: 'LOCAL_TEXT_OR_SCHEMA_INVALID' }));
                }
                const localPayload = { messages: localMessages, temperature: payload.temperature ?? 0.2,
                    max_tokens: payload.max_tokens ?? 400, ...(format ? { response_format: format } : {}) };
                try {
                    if (payload.stream === true) {
                        const { response: upstream, cleanup } = await localBrain.stream(localPayload, controller.signal);
                        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', ...contextHeaders });
                        try {
                            for await (const chunk of upstream.body) {
                                if (controller.signal.aborted) break;
                                res.write(chunk);
                            }
                            return res.end();
                        } finally { cleanup(); }
                    }
                    const answer = await localBrain.generate(localPayload, controller.signal);
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...contextHeaders });
                    return res.end(JSON.stringify(answer));
                } catch (error) {
                    if (res.headersSent || res.destroyed) return res.end();
                    const code = error.code || 'LOCAL_PROVIDER_UNAVAILABLE';
                    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                    return res.end(JSON.stringify({ success: false, code, error: code, reason: error.cause || error.message }));
                }
            }
            // v42 — Sin OpenAI: el chat corre sobre Gemini devolviendo el
            // mismo shape de OpenAI (choices[0].message.content) para que
            // ningún cliente cambie.
            if (!OPENAI_API_KEY) {
                try {
                    if (!geminiClient.hasKey()) {
                        res.writeHead(503, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: { message: 'Sin proveedor LLM configurado' } }));
                    }
                    const jsonMode = payload.response_format?.type === 'json_object';
                    const llmOpts = {
                        messages: payload.messages,
                        temperature: payload.temperature ?? 0.4,
                        maxTokens: payload.max_tokens ?? 900,
                        jsonMode
                    };
                    let content, servedBy = 'gemini';
                    try {
                        content = await geminiClient.generateText(llmOpts);
                    } catch (e) {
                        // v46 — cuota de Gemini agotada → cadena de respaldo gratuita
                        console.warn('[chat] Gemini falló — respaldo gratuito:', e.message.slice(0, 100));
                        content = await fallbackLLM.chatComplete(llmOpts);
                        servedBy = 'fallback';
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json', ...contextHeaders });
                    return res.end(JSON.stringify({
                        id: 'gmn-' + Date.now().toString(36),
                        object: 'chat.completion',
                        model: servedBy,
                        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
                        usage: {}
                    }));
                } catch (e) {
                    const code = /HTTP 4/.test(e.message) ? 400 : 500;
                    res.writeHead(code, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: { message: e.message } }));
                }
            }

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
                    res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json', ...contextHeaders });
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

    // Static file serving — allowlist cerrada. Nunca se sirve el repositorio.
    if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET, HEAD' });
        return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
    // Evita un 404 ruidoso cuando todavía no hay un favicon dedicado.
    if (parsedUrl.pathname === '/favicon.ico') {
        res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' });
        return res.end();
    }
    const legacyDestination = LEGACY_PAGE_REDIRECTS[parsedUrl.pathname];
    if (legacyDestination) {
        res.writeHead(308, { Location: legacyDestination, 'Cache-Control': 'public, max-age=86400' });
        return res.end();
    }
    const filePath = resolvePublicPath(parsedUrl.pathname);
    if (!filePath) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Not found' }));
    }
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
            } else if (/\.[a-f0-9]{8,}\./i.test(baseName) || parsedUrl.query?.v) {
                headers['Cache-Control'] = 'public, max-age=31536000, immutable';
            } else if (extname === '.html' || baseName === 'manifest.json') {
                headers['Cache-Control'] = 'no-cache';
            } else {
                headers['Cache-Control'] = 'public, max-age=3600';
            }
            res.writeHead(200, headers);
            res.end(req.method === 'HEAD' ? undefined : content, 'utf-8');
        }
    });
};

// Create server — resuelve el usuario de la sesión y ejecuta el handler
// dentro de su contexto. Los stores per-user leen el uid de aquí.
//
// ⚠️ Los eventos del request ('data'/'end') se emiten desde el contexto del
// socket TCP, FUERA del ALS. AsyncResource.bind liga cada listener al
// contexto del usuario para que no se pierda dentro de los callbacks.
const { AsyncResource } = require('async_hooks');
const server = http.createServer((req, res) => {
    const who = auth.authenticate(req);
    const uid = who && who.kind === 'user' ? who.user.id : null;
    userContext.runAs(uid, () => {
        const origOn = req.on.bind(req);
        req.on = (ev, cb) => origOn(ev, AsyncResource.bind(cb));
        handleRequest(req, res);
    });
});

server.requestTimeout = 10 * 60 * 1000;
server.headersTimeout = 30 * 1000;
server.keepAliveTimeout = 5 * 1000;
server.maxHeadersCount = 100;

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
    console.log('║    POST /api/jobs            - Procesos durables y recordatorios');
    console.log('║    *    /api/push/*          - Alertas Web Push por dispositivo');
    console.log('║    *    /api/control/*       - Contracts, flags, plans, nodes, skills y operations');
    console.log('║    POST /api/style-mirror    - F5: Modo espejo (clonado de estilo)');
    console.log('║    POST /api/forecast        - F6: Forecast probabilístico');
    console.log('╚════════════════════════════════════════════════');
    console.log('');
    jobs?.start?.();
    mobilePushScheduler?.start?.();
});

server.on('close', () => { jobs?.stop?.(); mobilePushScheduler?.stop?.(); });

// ===== v47 — Arranque resiliente =====
// WhatsApp: si hay sesión guardada en disco, reconectar solo (sin QR).
// Antes, cada restart del server dejaba el puente muerto hasta que
// alguien pulsara "Conectar" en config.
if (wa) {
    try {
        if (fs.existsSync(path.join(process.env.GUNTER_WHATSAPP_SESSION_DIR || path.join(__dirname, 'whatsapp-session'), 'creds.json'))) {
            console.log('📱 [wa] Sesión guardada encontrada — reconectando WhatsApp…');
            wa.start().catch(e => console.warn('[wa] auto-reconexión falló:', e.message));
        }
    } catch { }
}

// Backups automáticos de data/ + whatsapp-data/ (cada 12 h, retención 14)
if (process.env.GUNTER_DISABLE_BACKUPS !== 'true') {
    try { require('./server/backup').schedule(); }
    catch (e) { console.warn('⚠️  Backup module no disponible:', e.message); }
}

// El cuerpo de audio puede tardar, pero las cabeceras y conexiones ociosas no.
server.timeout = 600000;
console.log('⏱️  Upload timeout: 10 min · headers: 30 s · keep-alive: 5 s');

// ---------- Helpers ----------

// Cache de TTS en disco (v43): Gunter repite muchas frases ("Listo.",
// "Quedó agendado.") — cachear el audio ahorra red y cuota.
// Clave = sha1(voz+texto). Tope ~400 archivos (se purgan los más viejos).
// v44 — Cadena de proveedores: Edge TTS (neuronal, sin cuota) → Gemini TTS.
const TTS_CACHE_DIR = path.join(process.env.GUNTER_DATA_DIR || path.join(__dirname, 'data'), 'tts-cache');
let edgeTts = null;
try { edgeTts = require('./server/edge-tts-client'); }
catch (e) { console.warn('⚠️  Edge TTS no disponible:', e.message); }

async function ttsCachedSynthesize(text, voice) {
    const crypto = require('crypto');
    const key = crypto.createHash('sha1').update(voice + '|' + text).digest('hex');
    // Cache hit (mp3 = Edge, wav = Gemini)
    for (const [ext, mime] of [['mp3', 'audio/mpeg'], ['wav', 'audio/wav']]) {
        const f = path.join(TTS_CACHE_DIR, key + '.' + ext);
        try { if (fs.existsSync(f)) return { buffer: fs.readFileSync(f), mime }; } catch { }
    }

    let result = null;
    if (edgeTts && edgeTts.available()) {
        try { result = await edgeTts.synthesizeSpeech({ text, voice }); }
        catch (e) { console.warn('[tts] Edge falló, probando Gemini:', e.message.slice(0, 100)); }
    }
    if (!result) result = await geminiClient.synthesizeSpeech({ text, voice });

    try {
        if (!fs.existsSync(TTS_CACHE_DIR)) fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
        const ext = result.mime === 'audio/mpeg' ? 'mp3' : 'wav';
        fs.writeFileSync(path.join(TTS_CACHE_DIR, key + '.' + ext), result.buffer);
        // Higiene: máx ~400 audios en cache
        const files = fs.readdirSync(TTS_CACHE_DIR);
        if (files.length > 400) {
            files.map(f => ({ f, t: fs.statSync(path.join(TTS_CACHE_DIR, f)).mtimeMs }))
                .sort((a, b) => a.t - b.t)
                .slice(0, 80)
                .forEach(x => { try { fs.unlinkSync(path.join(TTS_CACHE_DIR, x.f)); } catch { } });
        }
    } catch (e) { console.warn('[tts-cache] no se pudo guardar:', e.message); }
    return result;
}

// Parser multipart mínimo (v42): extrae el primer archivo + campo 'language'
// del form-data que el cliente manda a /api/transcribe. Sin dependencias.
function extractMultipartFile(buffer, contentType) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
    if (!m) return null;
    const bBuf = Buffer.from('--' + (m[1] || m[2]).trim());
    const parts = [];
    let idx = buffer.indexOf(bBuf);
    while (idx !== -1) {
        const next = buffer.indexOf(bBuf, idx + bBuf.length);
        if (next === -1) break;
        parts.push(buffer.slice(idx + bBuf.length, next));
        idx = next;
    }
    let language = '';
    let file = null;
    for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const head = part.slice(0, headerEnd).toString('utf8');
        const data = part.slice(headerEnd + 4, part.length - 2);   // sin el \r\n final
        const nameM = /name="([^"]+)"/i.exec(head);
        const fileM = /filename="([^"]*)"/i.exec(head);
        const ctM = /Content-Type:\s*([^\r\n]+)/i.exec(head);
        if (fileM) {
            file = { data, mime: ctM ? ctM[1].trim() : 'audio/webm', filename: fileM[1] || 'audio' };
        } else if (nameM && nameM[1] === 'language') {
            language = data.toString('utf8').trim();
        }
    }
    return file ? { file, language } : null;
}

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
