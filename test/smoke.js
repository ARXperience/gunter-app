/* =============================================
   GUNTER — Smoke Tests
   -------------------------------------------------
   Valida que el server esté sano end-to-end.
   Requiere el server corriendo en localhost:3001.

   Uso: npm test   (o node test/smoke.js)
   Exit 0 = todo verde. Exit 1 = al menos un fallo.
   ============================================= */

const BASE = process.env.GUNTER_URL || 'http://localhost:3001';

// Service token — generado por el server en data/service-token.json.
// Da acceso nivel admin a los tests (mismo dominio de confianza que .env).
const fs = require('fs');
const path = require('path');
let SERVICE_TOKEN = null;
try {
    SERVICE_TOKEN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'service-token.json'), 'utf8')).token;
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
    return t ? { 'Authorization': 'Bearer ' + t } : {};
}
async function jpost(path, body, token) {
    const resp = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._authHeaders(token) },
        body: JSON.stringify(body)
    });
    return { status: resp.status, json: await resp.json().catch(() => null) };
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
        const on = Object.entries(json?.services || {}).filter(([, v]) => v).length;
        on >= 8 ? ok(`services on (${on})`) : ko('services', `solo ${on} activos`);
    } catch (e) { ko('health', e.message); }
}

async function testEndpointsRegistered() {
    console.log('\n── Endpoints registrados (400 con body vacío = registrado) ──');
    const posts = ['/api/chat', '/api/transcribe', '/api/tts', '/api/embeddings',
                   '/api/gemini-text', '/api/gemini-image',
                   '/api/commitments', '/api/proactive', '/api/style-mirror', '/api/forecast'];
    for (const ep of posts) {
        try {
            const { status } = await jpost(ep, {});
            (status === 400 || status === 200)
                ? ok(`POST ${ep} (${status})`)
                : ko(`POST ${ep}`, `status=${status}`);
        } catch (e) { ko(`POST ${ep}`, e.message); }
    }
    const gets = ['/api/gemini-status', '/api/google/status', '/api/premium-intel/actions',
                  '/api/knowledge/stats', '/api/whatsapp/status'];
    for (const ep of gets) {
        try {
            const { status } = await jget(ep);
            status === 200 ? ok(`GET ${ep}`) : ko(`GET ${ep}`, `status=${status}`);
        } catch (e) { ko(`GET ${ep}`, e.message); }
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
}

async function testTutorSage() {
    console.log('\n── Tutor / Sage ──');
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

    try {
        const { json } = await jpost('/api/tutor', { op: 'notes-pull', userId: 'smoke-test' });
        json?.success ? ok('notes-pull') : ko('notes-pull', 'no success');
    } catch (e) { ko('notes-pull', e.message); }

    // sage-bulk (warmup en 1 request)
    try {
        const { json } = await jpost('/api/tutor', { op: 'sage-bulk' });
        const d = json?.data;
        (d?.inventory?.indexed?.length === 33 && Object.keys(d.digests || {}).length >= 30)
            ? ok(`sage-bulk (${Object.keys(d.digests).length} digests en 1 request)`)
            : ko('sage-bulk', JSON.stringify({ inv: d?.inventory?.indexed?.length, dig: Object.keys(d?.digests || {}).length }));
    } catch (e) { ko('sage-bulk', e.message); }

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
        const user = reg.json?.user, userToken = reg.json?.token;
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

        const rm = await jpost('/api/auth/admin/remove', { userId: user.id });
        rm.json?.success ? ok('admin remove (cleanup)') : ko('admin remove', JSON.stringify(rm.json).slice(0, 100));

        // Al eliminar el usuario, su carpeta de datos desaparece del disco
        const userDataDir = path.join(__dirname, '..', 'data', 'users', user.id);
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
        '/js/services/gunter-rules-service.js'
    ];
    for (const a of assets) {
        try {
            const status = await head(a);
            status === 200 ? ok(a) : ko(a, `status=${status}`);
        } catch (e) { ko(a, e.message); }
    }
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
    await testAuth();
    await testEndpointsRegistered();
    await testActionsDispatch();
    await testTutorSage();
    await testAssets();
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
