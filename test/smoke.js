/* =============================================
   GUNTER — Smoke Tests
   -------------------------------------------------
   Valida que el server esté sano end-to-end.
   `npm test` arranca un server temporal cuando hace falta.

   Uso: npm test   (o node test/smoke.js)
   Exit 0 = todo verde. Exit 1 = al menos un fallo.
   ============================================= */

const BASE = process.env.GUNTER_URL || 'http://localhost:3001';

// Service token — generado por el server en data/service-token.json.
// Da acceso nivel admin a los tests (mismo dominio de confianza que .env).
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.resolve(process.env.GUNTER_DATA_DIR || path.join(__dirname, '..', 'data'));
let SERVICE_TOKEN = null;
try {
    SERVICE_TOKEN = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'service-token.json'), 'utf8')).token;
} catch { /* server nunca arrancó aún — los tests de auth lo reportarán */ }

let passed = 0, failed = 0;
const failures = [];

function ok(name) { passed++; console.log(`  ✓ ${name}`); }
function ko(name, detail) {
    failed++;
    failures.push({ name, detail });
    console.log(`  ✗ ${name} — ${detail}`);
}

// token: undefined → service token · null → sin auth · string → ese token
function _authHeaders(token) {
    const t = token === undefined ? SERVICE_TOKEN : token;
    if (!t) return {};
    return String(t).startsWith('gunter_session=')
        ? { 'Cookie': String(t) }
        : { 'Authorization': 'Bearer ' + t };
}
async function jpost(path, body, token) {
    const resp = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._authHeaders(token) },
        body: JSON.stringify(body)
    });
    return {
        status: resp.status,
        json: await resp.json().catch(() => null),
        cookie: (resp.headers.get('set-cookie') || '').split(';')[0] || null
    };
}
async function jget(path, token) {
    const resp = await fetch(BASE + path, { headers: _authHeaders(token) });
    return { status: resp.status, json: await resp.json().catch(() => null) };
}
async function head(path) {
    const resp = await fetch(BASE + path, { method: 'GET' });
    return resp.status;
}

// ═════════════════════════════════════════════
async function testHealth() {
    console.log('\n── Health ──');
    try {
        const { status, json } = await jget('/api/health');
        status === 200 && json?.status === 'ok'
            ? ok('GET /api/health')
            : ko('GET /api/health', `status=${status}`);
        const on = Object.values(json?.services || {}).filter(value => value === true).length;
        on >= 8 ? ok(`services on (${on})`) : ko('services', `solo ${on} activos`);
        typeof json?.mobileNotifications?.androidFcm === 'boolean' && typeof json?.mobileNotifications?.iosApns === 'boolean'
            ? ok('health informa preparación Android/iOS sin exponer secretos')
            : ko('mobile notification readiness', JSON.stringify(json?.mobileNotifications));
    } catch (e) { ko('health', e.message); }
}

async function testLegacyNavigation() {
    console.log('\n── Navegación unificada ──');
    const routes = {
        '/chat.html': '/day.html#chat',
        '/tasks.html': '/day.html#tasks',
        '/calendar.html': '/day.html#events',
        '/meetings.html': '/dashboard.html',
        '/documents.html': '/day.html#documents',
        '/inbox.html': '/day.html#conversations'
    };
    for (const [source, destination] of Object.entries(routes)) {
        const response = await fetch(BASE + source, { redirect: 'manual' });
        const location = response.headers.get('location');
        response.status === 308 && location === destination
            ? ok(`${source} → ${destination}`)
            : ko(`redirect ${source}`, `status=${response.status}, location=${location}`);
    }
}

async function testEndpointsRegistered() {
    console.log('\n── Endpoints registrados (400 con body vacío = registrado) ──');
    const posts = ['/api/chat', '/api/transcribe', '/api/tts', '/api/embeddings',
                   '/api/gemini-text', '/api/gemini-image',
                   '/api/commitments', '/api/proactive', '/api/style-mirror', '/api/forecast',
                   '/api/jobs'];
    const optionalProviders = new Set(['/api/transcribe', '/api/tts', '/api/gemini-text', '/api/gemini-image']);
    for (const ep of posts) {
        try {
            const { status } = await jpost(ep, {});
            // Registration smoke: optional cloud/model providers may be unavailable
            // in a clean checkout. Their live behavior has separate gated tests.
            (status === 400 || status === 200 || (optionalProviders.has(ep) && status === 503))
                ? ok(`POST ${ep} (${status})`)
                : ko(`POST ${ep}`, `status=${status}`);
        } catch (e) { ko(`POST ${ep}`, e.message); }
    }
    const gets = ['/api/gemini-status', '/api/google/status', '/api/premium-intel/actions',
                  '/api/knowledge/stats', '/api/whatsapp/status', '/api/push/public-key', '/api/push/status'];
    for (const ep of gets) {
        try {
            const { status } = await jget(ep);
            status === 200 ? ok(`GET ${ep}`) : ko(`GET ${ep}`, `status=${status}`);
        } catch (e) { ko(`GET ${ep}`, e.message); }
    }
}

async function testControlPlane() {
    console.log('\n── Control Plane v1 ──');
    const routes = [
        ['/api/control/contracts', data => data?.version === '1.0.0'],
        ['/api/control/capabilities', data => data?.stats?.total === 44 && data?.governance?.length === 4],
        ['/api/control/health', data => !!data?.protocolVersion],
        ['/api/control/sync/status', data => typeof data?.receipts === 'number'],
        ['/api/control/flags', data => Array.isArray(data?.items)],
        ['/api/control/plans', data => Array.isArray(data?.items)],
        ['/api/control/settings', data => Array.isArray(data?.items)],
        ['/api/control/skills', data => Array.isArray(data?.items)],
        ['/api/control/workflows', data => Array.isArray(data?.items) && !!data?.stats],
        ['/api/control/activity', data => Array.isArray(data?.items) && !!data?.stats],
        ['/api/control/social/connections', data => Array.isArray(data?.items) && data.items.length === 3],
        ['/api/control/conversations', data => Array.isArray(data?.items) && !!data?.stats],
        ['/api/control/procedures', data => Array.isArray(data?.items) && !!data?.stats],
        ['/api/control/models', data => Array.isArray(data?.items) && data.items.length > 0],
        ['/api/control/cortex/memories', data => Array.isArray(data?.items) && !!data?.stats],
        ['/api/control/attention', data => Array.isArray(data?.items)],
        ['/api/control/operations/overview', data => !!data?.health]
    ];
    for (const [route, check] of routes) {
        try {
            const { status, json } = await jget(route);
            status === 200 && json?.success && check(json.data)
                ? ok(`GET ${route}`)
                : ko(`GET ${route}`, `status=${status} body=${JSON.stringify(json).slice(0, 100)}`);
        } catch (error) { ko(`GET ${route}`, error.message); }
    }

    try {
        const { status } = await jget('/api/control/missions');
        status === 403
            ? ok('misiones experimentales bloqueadas por defecto')
            : ko('gate de misiones', `status=${status}`);
    } catch (error) { ko('gate de misiones', error.message); }

    try {
        const { status, json } = await jpost('/api/control/context/envelope', { text: 'qué tengo hoy a las 15:00', sessionId: 'smoke', timezone: 'America/Bogota' });
        status === 200 && json?.data?.envelope?.references?.temporal?.length
            ? ok('Context Gateway resuelve fecha/hora real')
            : ko('Context Gateway', `status=${status}, response=${JSON.stringify(json)}`);
    } catch (error) { ko('Context Gateway', error.message); }

    for (const route of ['/api/control/graph', '/api/control/learnings']) {
        try {
            const { status } = await jget(route);
            status === 403 ? ok(`${route} protegido por defecto`) : ko(`gate ${route}`, `status=${status}`);
        } catch (error) { ko(`gate ${route}`, error.message); }
    }
}

async function testActionsDispatch() {
    console.log('\n── Actions dispatch (NLU) ──');
    const cases = [
        ['activa la memoria conversacional', 'conversationMemory'],
        ['activa el pulso proactivo', 'proactivePulse'],
        ['activa el forecast', 'projectForecast'],
        ['activa la voz', 'voiceEnabled'],
        ['activa modo tutor', 'tutorMode'],
        ['activa proyecto 360', 'project360'],
        ['activa alertas de whatsapp', 'smartWhatsappAlerts']
    ];
    for (const [phrase, expected] of cases) {
        try {
            // limpiar pending primero
            await jpost('/api/actions', { op: 'dispatch', text: 'no' });
            const { json } = await jpost('/api/actions', { op: 'dispatch', text: phrase });
            const feat = json?.data?.feature;
            feat === expected
                ? ok(`"${phrase}" → ${feat}`)
                : ko(`"${phrase}"`, `esperaba ${expected}, obtuvo ${feat || json?.data?.intent}`);
        } catch (e) { ko(`"${phrase}"`, e.message); }
    }

    const settingsCases = [
        ['cambia modo de voz a solo con wake word', 'voiceMode', 'wake_word_only'],
        ['cambia personalidad a suave', 'personalityIntensity', 'soft'],
        ['cambia modo de escucha a continuo', 'wakeWordListeningMode', 'continuous'],
        ['cambia la palabra de activación personalizada a Computer', 'wakeWord', 'Computer'],
        ['cambia el tiempo de escucha a 30 segundos', 'wakeWordAutoStopSeconds', 30],
        ['desactiva modo sabio', 'tutorMode', false]
    ];
    for (const [phrase, expectedFeature, expectedValue] of settingsCases) {
        try {
            await jpost('/api/actions', { op: 'dispatch', text: 'no' });
            const { json } = await jpost('/api/actions', { op: 'dispatch', text: phrase });
            const result = json?.data;
            result?.intent === 'applied' && result.feature === expectedFeature && result.value === expectedValue
                ? ok(`"${phrase}" → ${result.feature}=${result.value}`)
                : ko(`"${phrase}"`, `esperaba ${expectedFeature}=${expectedValue}, obtuvo ${result?.feature}=${result?.value} (${result?.intent})`);
        } catch (e) { ko(`"${phrase}"`, e.message); }
    }
}

async function testTutorSage() {
    console.log('\n── Tutor / Sage ──');
    const indexDir = path.join(__dirname, '..', 'tutor-library', 'index');
    const requiredIndex = ['chunks.json', 'postings.json', 'stats.json', 'concepts.json', 'cross-refs.json'];
    const present = requiredIndex.map(name => fs.existsSync(path.join(indexDir, name)));
    const indexed = present.every(Boolean);
    if (present.some(Boolean) && !indexed) ko('sage-index', 'índice local incompleto');
    if (indexed) {
    try {
        const { json } = await jpost('/api/tutor', { op: 'sage-status' });
        const d = json?.data;
        (d?.loaded && d.chunks > 1000)
            ? ok(`sage-status (${d.chunks} chunks, ${d.vocab} vocab)`)
            : ko('sage-status', JSON.stringify(d).slice(0, 100));
    } catch (e) { ko('sage-status', e.message); }

    try {
        const { json } = await jpost('/api/tutor', { op: 'sage-inventory' });
        const n = json?.data?.indexed?.length;
        n === 33 ? ok(`sage-inventory (33/33 indexadas)`) : ko('sage-inventory', `${n}/33`);
    } catch (e) { ko('sage-inventory', e.message); }

    const queries = [
        ['meditacion taoista', '8'],
        ['lattice campo neuronal', '9'],
        ['pachita cirugia', '11']
    ];
    for (const [q, expectBook] of queries) {
        try {
            const { json } = await jpost('/api/tutor', { op: 'sage-query', query: q, limit: 3 });
            const hits = json?.data?.primaryHits || json?.data?.hits || [];
            const topBooks = hits.slice(0, 3).map(h => h.workN);
            topBooks.includes(expectBook)
                ? ok(`sage-query "${q}" → #${expectBook} en top-3`)
                : ko(`sage-query "${q}"`, `top: ${topBooks.join(',')}, esperaba #${expectBook}`);
        } catch (e) { ko(`sage-query "${q}"`, e.message); }
    }

    try {
        const { json } = await jpost('/api/tutor', { op: 'sage-digest', n: '9' });
        const d = json?.data;
        (d?.title && d.stats?.wordCount > 20000)
            ? ok(`sage-digest #9 (${d.stats.wordCount} palabras)`)
            : ko('sage-digest #9', JSON.stringify(d?.stats || {}).slice(0, 80));
    } catch (e) { ko('sage-digest', e.message); }

    try {
        const { json } = await jpost('/api/tutor', { op: 'sage-synthesize', query: 'meditación y campo unificado' });
        const books = json?.data?.contributingBooks?.length || 0;
        books >= 3 ? ok(`sage-synthesize (${books} libros contribuyen)`) : ko('sage-synthesize', `solo ${books} libros`);
    } catch (e) { ko('sage-synthesize', e.message); }
    } else {
        try {
            const { json } = await jpost('/api/tutor', { op: 'sage-status' });
            json?.data?.loaded === false ? ok('sage-status informa índice local no instalado')
                : ko('sage-status', 'estado inesperado sin índice local');
        } catch (e) { ko('sage-status', e.message); }
    }

    try {
        const { json } = await jpost('/api/tutor', { op: 'notes-pull', userId: 'smoke-test' });
        json?.success ? ok('notes-pull') : ko('notes-pull', 'no success');
    } catch (e) { ko('notes-pull', e.message); }

    // sage-bulk requires the optional local index.
    if (indexed) {
    try {
        const { json } = await jpost('/api/tutor', { op: 'sage-bulk' });
        const d = json?.data;
        (d?.inventory?.indexed?.length === 33 && Object.keys(d.digests || {}).length >= 30)
            ? ok(`sage-bulk (${Object.keys(d.digests).length} digests en 1 request)`)
            : ko('sage-bulk', JSON.stringify({ inv: d?.inventory?.indexed?.length, dig: Object.keys(d?.digests || {}).length }));
    } catch (e) { ko('sage-bulk', e.message); }
    }

    // teach roundtrip: add → search → remove
    try {
        const add = await jpost('/api/tutor', { op: 'teach-add', title: '__smoke__', text: 'Entrada de prueba del smoke test con palabras únicas: zorrocloco verificable.' });
        const id = add.json?.data?.id;
        if (!id) throw new Error('add falló');
        const search = await jpost('/api/tutor', { op: 'teach-search', query: 'zorrocloco verificable' });
        const found = (search.json?.data?.hits || []).some(h => h.id === id);
        await jpost('/api/tutor', { op: 'teach-remove', id });
        found ? ok('teach add→search→remove') : ko('teach', 'búsqueda no encontró la entrada');
    } catch (e) { ko('teach roundtrip', e.message); }
}

async function testAuth() {
    console.log('\n── Auth (guard + aprobación admin) ──');

    if (!SERVICE_TOKEN) {
        ko('service token', 'data/service-token.json no existe — arranca el server al menos una vez');
        return;
    }

    // Guard: sin token → 401
    try {
        const { status } = await jpost('/api/actions', { op: 'get_state' }, null);
        status === 401 ? ok('guard: /api/* sin sesión → 401') : ko('guard sin sesión', `status=${status}`);
    } catch (e) { ko('guard sin sesión', e.message); }

    try {
        const denied = await jpost('/api/location/reverse', { latitude: 0, longitude: 0 }, null);
        denied.status === 401 ? ok('ubicación exige sesión aprobada') : ko('ubicación protegida', `status=${denied.status}`);
        const invalid = await jpost('/api/location/reverse', { latitude: 91, longitude: 0 });
        invalid.status === 400 ? ok('ubicación rechaza coordenadas inválidas sin consultar proveedores') : ko('ubicación válida', `status=${invalid.status}`);
    } catch (e) { ko('ubicación segura', e.message); }

    // Público: setup-status responde sin auth
    try {
        const { status, json } = await jget('/api/auth/setup-status', null);
        (status === 200 && json?.success !== undefined)
            ? ok('setup-status público')
            : ko('setup-status', `status=${status}`);
    } catch (e) { ko('setup-status', e.message); }

    // Service token pasa el guard
    try {
        const { status } = await jpost('/api/actions', { op: 'get_state' });
        status === 200 ? ok('guard: service token → 200') : ko('guard service token', `status=${status}`);
    } catch (e) { ko('guard service token', e.message); }

    // Roundtrip: registro → pending → 403 → aprobar → 200 → eliminar
    try {
        const { json: setup } = await jget('/api/auth/setup-status', null);
        if (setup?.needsSetup) {
            ok('roundtrip omitido (sin usuarios aún — el primero sería admin)');
            return;
        }
        const uname = 'smoke' + Date.now().toString(36);
        const reg = await jpost('/api/auth/register', { username: uname, password: 'smoke-pass-1234', displayName: 'Smoke Test' });
        const user = reg.json?.user, userToken = reg.cookie;
        if (!user || !userToken) throw new Error('registro falló: ' + JSON.stringify(reg.json).slice(0, 100));
        user.status === 'pending' ? ok('registro → estado pending') : ko('registro', `estado=${user.status}`);

        const g1 = await jpost('/api/actions', { op: 'get_state' }, userToken);
        g1.status === 403 ? ok('pending → guard 403') : ko('guard pending', `status=${g1.status}`);

        const ap = await jpost('/api/auth/admin/approve', { userId: user.id });
        ap.json?.success ? ok('admin approve') : ko('admin approve', JSON.stringify(ap.json).slice(0, 100));

        const g2 = await jpost('/api/actions', { op: 'get_state' }, userToken);
        g2.status === 200 ? ok('aprobado → guard 200') : ko('guard aprobado', `status=${g2.status}`);

        // ── WhatsApp: vincular teléfono propio (mapeo teléfono→usuario) ──
        const sp = await jpost('/api/auth/set-phone', { phone: '+57 300 ' + String(Date.now()).slice(-7) }, userToken);
        // set-phone normaliza a dígitos; verificamos con /me
        const me2 = await jget('/api/auth/me', userToken);
        (sp.json?.success && me2.json?.user?.waPhone && /^\d{8,15}$/.test(me2.json.user.waPhone))
            ? ok(`set-phone → +${me2.json.user.waPhone}`)
            : ko('set-phone', JSON.stringify(sp.json).slice(0, 100));

        // ── Tutor 📚 (v50): bloqueado por defecto, se concede desde admin ──
        const tGate = await jpost('/api/tutor', { op: 'catalog' }, userToken);
        tGate.status === 403 ? ok('tutor bloqueado sin permiso (403)') : ko('tutor gate', `status=${tGate.status}`);
        const tGrant = await jpost('/api/auth/admin/tutor-access', { userId: user.id, allow: true });
        tGrant.json?.success ? ok('admin concede tutor') : ko('tutor-access', JSON.stringify(tGrant.json).slice(0, 80));

        // ── Aislamiento multi-tenant: lo que guarda el usuario NO lo ve el dueño ──
        const secret = 'aislamiento' + Date.now().toString(36);
        const tAdd = await jpost('/api/tutor', { op: 'teach-add', title: 'privado', text: `Dato privado del usuario: ${secret}.` }, userToken);
        const teachId = tAdd.json?.data?.id;
        teachId ? ok('usuario guarda saber personal') : ko('teach-add usuario', JSON.stringify(tAdd.json).slice(0, 100));

        const mine = await jpost('/api/tutor', { op: 'teach-search', query: secret }, userToken);
        (mine.json?.data?.hits || []).some(h => h.id === teachId)
            ? ok('usuario SÍ ve su dato') : ko('aislamiento (propio)', 'el usuario no encuentra su propio dato');

        const owner = await jpost('/api/tutor', { op: 'teach-search', query: secret });   // service → contexto del dueño
        !(owner.json?.data?.hits || []).some(h => h.id === teachId)
            ? ok('dueño NO ve el dato del usuario (aislado)') : ko('aislamiento (cruce)', 'FUGA: el dato del usuario apareció en otro contexto');

        // ── Procesos durables: crear, persistir, cancelar, ejecutar y aislar ──
        const cancelTitle = `recordatorio-cancel-${Date.now().toString(36)}`;
        const cancelCreate = await jpost('/api/jobs', {
            op: 'create', params: { type: 'reminder', title: cancelTitle, runAt: new Date(Date.now() + 60_000).toISOString() }
        }, userToken);
        const cancelJob = cancelCreate.json?.data?.job;
        cancelJob?.status === 'scheduled'
            ? ok('job durable creado y persistido') : ko('job create', JSON.stringify(cancelCreate.json).slice(0, 120));

        const cancelResult = await jpost('/api/jobs', { op: 'cancel', params: { id: cancelJob?.id } }, userToken);
        cancelResult.json?.data?.job?.status === 'cancelled'
            ? ok('job durable cancelado') : ko('job cancel', JSON.stringify(cancelResult.json).slice(0, 120));

        const dueTitle = `recordatorio-due-${Date.now().toString(36)}`;
        const dueCreate = await jpost('/api/jobs', {
            op: 'create', params: { type: 'reminder', title: dueTitle, runAt: new Date().toISOString() }
        }, userToken);
        const dueJob = dueCreate.json?.data?.job;
        await jpost('/api/jobs', { op: 'run_due' }, userToken);
        const dueGet = await jpost('/api/jobs', { op: 'get', params: { id: dueJob?.id } }, userToken);
        const completedJob = dueGet.json?.data?.job;
        (completedJob?.status === 'completed' && completedJob?.result?.interventionId)
            ? ok('job vencido ejecuta con evidencia persistente')
            : ko('job run_due', JSON.stringify(dueGet.json).slice(0, 160));

        const ownerJobs = await jpost('/api/jobs', { op: 'list', params: { limit: 200 } });
        !(ownerJobs.json?.data?.items || []).some(job => job.id === dueJob?.id || job.id === cancelJob?.id)
            ? ok('jobs aislados entre usuarios') : ko('jobs aislamiento', 'FUGA: job temporal visible por el dueño');

        const pushSubscription = { endpoint: `https://push.example.test/${user.id}`, keys: { p256dh: 'public-test-key', auth: 'auth-test-key' } };
        const pushAdded = await jpost('/api/push/subscribe', { subscription: pushSubscription, deviceLabel: 'Móvil smoke' }, userToken);
        pushAdded.json?.data?.device?.id ? ok('Web Push registra el dispositivo por usuario') : ko('push subscribe', JSON.stringify(pushAdded.json).slice(0, 140));
        const pushState = await jget('/api/push/status', userToken);
        pushState.json?.data?.devices?.length === 1 ? ok('Web Push refleja la suscripción activa') : ko('push status', JSON.stringify(pushState.json).slice(0, 140));
        const pushRemoved = await jpost('/api/push/unsubscribe', { endpoint: pushSubscription.endpoint }, userToken);
        pushRemoved.json?.data?.removed === true ? ok('Web Push permite desactivar este dispositivo') : ko('push unsubscribe', JSON.stringify(pushRemoved.json).slice(0, 140));

        // Cambiar la contraseña revoca sesiones anteriores y rota la sesión actual.
        const passwordChange = await jpost('/api/auth/change-password', {
            current: 'smoke-pass-1234', next: 'smoke-pass-5678'
        }, userToken);
        const rotatedToken = passwordChange.cookie;
        (passwordChange.status === 200 && passwordChange.json?.success && rotatedToken)
            ? ok('cambio de contraseña rota la cookie de sesión')
            : ko('cambio de contraseña', JSON.stringify(passwordChange.json).slice(0, 140));
        const staleSession = await jget('/api/auth/me', userToken);
        staleSession.status === 401
            ? ok('sesión anterior revocada al cambiar contraseña')
            : ko('revocación de sesión', `status=${staleSession.status}`);
        const freshSession = await jget('/api/auth/me', rotatedToken);
        freshSession.status === 200 && freshSession.json?.user?.id === user.id
            ? ok('sesión rotada conserva acceso en el dispositivo actual')
            : ko('sesión rotada', JSON.stringify(freshSession.json).slice(0, 140));
        const oldPassword = await jpost('/api/auth/login', { username: uname, password: 'smoke-pass-1234' }, null);
        oldPassword.status === 401
            ? ok('contraseña anterior deja de autenticar')
            : ko('contraseña anterior', `status=${oldPassword.status}`);
        const newPassword = await jpost('/api/auth/login', { username: uname, password: 'smoke-pass-5678' }, null);
        newPassword.status === 200 && newPassword.cookie
            ? ok('nueva contraseña permite iniciar sesión')
            : ko('nueva contraseña', `status=${newPassword.status}`);

        const rm = await jpost('/api/auth/admin/remove', { userId: user.id });
        rm.json?.success ? ok('admin remove (cleanup)') : ko('admin remove', JSON.stringify(rm.json).slice(0, 100));

        // Al eliminar el usuario, su carpeta de datos desaparece del disco
        const userDataDir = path.join(DATA_DIR, 'users', user.id);
        !fs.existsSync(userDataDir)
            ? ok('datos del usuario borrados al eliminarlo') : ko('borrado de datos', userDataDir + ' sigue existiendo');

        const g3 = await jpost('/api/actions', { op: 'get_state' }, userToken);
        g3.status === 401 ? ok('eliminado → sesión inválida 401') : ko('sesión post-remove', `status=${g3.status}`);
    } catch (e) { ko('auth roundtrip', e.message); }
}

async function testAssets() {
    console.log('\n── Assets críticos ──');
    const assets = [
        '/day.html', '/dashboard.html', '/config.html', '/meeting.html', '/results.html',
        '/login.html', '/admin.html', '/js/services/auth-service.js',
        '/manifest.json', '/service-worker.js',
        '/styles/gunter-design-system.css', '/styles/gunter-legacy-overrides.css',
        '/js/services/gunter-companion.js', '/js/services/tutor-service.js',
        '/js/services/tutor-notes-service.js', '/js/controllers/tutor-panel.js',
        '/js/services/actions-service.js', '/js/services/log-buffer.js',
        '/js/services/repaso-service.js', '/js/services/gunter-mood-service.js',
        '/js/services/gunter-rules-service.js',
        '/js/core/temporal-context.js', '/js/core/wake-invocation.js',
        '/js/core/conversation-state.js', '/js/core/assistant-tools.js',
        '/js/core/assistant-presence.js', '/js/controllers/presence-settings.js',
        '/js/core/workflow-orchestrator.js',
        '/js/services/jobs-service.js', '/js/services/voice-activity-service.js',
        '/styles/gunter-cinematic.css', '/js/services/gunter-cinematic-shell.js',
        '/styles/gunter-command-center.css', '/js/services/gunter-command-center.js',
        '/styles/pages/control-plane.css', '/js/services/control-plane-service.js',
        '/js/services/web-node-runtime.js', '/js/controllers/control-plane-settings.js',
        '/js/controllers/control-plane-admin.js'
        ,'/styles/pages/activity.css', '/js/controllers/activity-panel.js'
        ,'/styles/pages/conversations.css', '/styles/pages/social-settings.css', '/styles/pages/procedure-recorder.css'
        ,'/js/services/procedure-recorder.js', '/js/controllers/conversations-panel.js', '/js/controllers/social-settings-panel.js'
    ];
    for (const a of assets) {
        try {
            const status = await head(a);
            status === 200 ? ok(a) : ko(a, `status=${status}`);
        } catch (e) { ko(a, e.message); }
    }
}

async function testSecurity() {
    console.log('\n── Seguridad HTTP ──');
    const privatePaths = [
        '/.env', '/.git/config', '/server.js', '/server/auth/index.js',
        '/data/users.json', '/data/service-token.json', '/_backups/'
    ];
    for (const privatePath of privatePaths) {
        try {
            const resp = await fetch(BASE + privatePath, { redirect: 'manual' });
            resp.status === 404
                ? ok(`${privatePath} no es público`)
                : ko(privatePath, `debería responder 404, respondió ${resp.status}`);
        } catch (e) { ko(privatePath, e.message); }
    }

    try {
        const resp = await fetch(BASE + '/login.html');
        const csp = resp.headers.get('content-security-policy') || '';
        resp.headers.get('x-content-type-options') === 'nosniff'
            ? ok('X-Content-Type-Options: nosniff')
            : ko('X-Content-Type-Options', 'cabecera ausente');
        resp.headers.get('x-frame-options') === 'DENY'
            ? ok('X-Frame-Options: DENY')
            : ko('X-Frame-Options', 'cabecera ausente');
        csp.includes("frame-ancestors 'none'")
            ? ok('CSP bloquea framing')
            : ko('Content-Security-Policy', 'frame-ancestors no está protegido');
    } catch (e) { ko('security headers', e.message); }

    try {
        const resp = await fetch(BASE + '/favicon.ico');
        resp.status === 204
            ? ok('/favicon.ico sin error de consola')
            : ko('/favicon.ico', `status=${resp.status}`);
    } catch (e) { ko('/favicon.ico', e.message); }

    try {
        const denied = await fetch(BASE + '/api/health', {
            headers: { Origin: 'https://evil.example' }
        });
        denied.status === 403
            ? ok('CORS rechaza origen externo no autorizado')
            : ko('CORS allowlist', `status=${denied.status}`);
    } catch (e) { ko('CORS allowlist', e.message); }

    try {
        const resp = await fetch(BASE + '/api/actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ..._authHeaders() },
            body: JSON.stringify({ payload: 'x'.repeat(2 * 1024 * 1024 + 1) })
        });
        resp.status === 413
            ? ok('body JSON mayor a 2 MB → 413')
            : ko('límite body JSON', `status=${resp.status}`);
    } catch (e) { ko('límite body JSON', e.message); }
}

async function testEncoding() {
    console.log('\n── Encoding UTF-8 ──');
    try {
        const resp = await fetch(BASE + '/day.html');
        const text = await resp.text();
        !text.includes('�') && !/Ã[©³±]/.test(text)
            ? ok('day.html sin mojibake')
            : ko('day.html', 'contiene mojibake o U+FFFD');
        text.includes('Configuración') ? ok('tildes intactas') : ko('tildes', 'Configuración no encontrado');
    } catch (e) { ko('encoding', e.message); }
}

// ═════════════════════════════════════════════
(async () => {
    console.log(`GUNTER SMOKE TESTS — ${BASE}`);
    const t0 = Date.now();

    // Check server up first
    try { await jget('/api/health'); }
    catch {
        console.error('\n❌ Server no responde en ' + BASE + '. Arrancalo con: node server.js');
        process.exit(1);
    }

    await testHealth();
    await testLegacyNavigation();
    await testAuth();
    await testEndpointsRegistered();
    await testControlPlane();
    await testActionsDispatch();
    await testTutorSage();
    await testAssets();
    await testSecurity();
    await testEncoding();

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n═══ RESULTADO: ${passed} ✓ · ${failed} ✗ · ${secs}s ═══`);
    if (failed > 0) {
        console.log('\nFallos:');
        failures.forEach(f => console.log(`  · ${f.name}: ${f.detail}`));
        process.exit(1);
    }
    process.exit(0);
})();
