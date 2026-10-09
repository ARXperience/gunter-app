/* =============================================
   GUNTER - Service Worker (Fase 8)
   -------------------------------------------------
   Estrategias por tipo de request:
     /api/*                  �  network-only (jamás cachear; APIs vivas)
     navegación HTML         �  network-first, fallback al cache,
                               último fallback offline.html
     assets estáticos        �  cache-first con revalidación en background
     opaco / cross-origin    �  bypass (no interfiere)

   Versionado: bumpear SW_VERSION para invalidar todo el cache.
   ============================================= */

const SW_VERSION = "v110-personal-memory-backup-20261008";
const CACHE_PREFIX = 'gunter-';
const CACHE_STATIC = `${CACHE_PREFIX}static-${SW_VERSION}`;
const CACHE_PAGES  = `${CACHE_PREFIX}pages-${SW_VERSION}`;
const CACHE_RUNTIME = `${CACHE_PREFIX}runtime-${SW_VERSION}`;
const LEGACY_PAGE_REDIRECTS = Object.freeze({
    '/chat.html': '/day.html#chat',
    '/tasks.html': '/day.html#tasks',
    '/calendar.html': '/day.html#events',
    '/meetings.html': '/dashboard.html',
    '/documents.html': '/day.html#documents',
    '/inbox.html': '/day.html#conversations'
});

// Shell mínimo precacheado en install � solo lo que garantiza
// que el visualizador básico levante offline.
const PRECACHE_URLS = [
    '/',
    '/dashboard.html',
    '/day.html',
    '/meeting.html',
    '/config.html',
    '/results.html',
    '/index.html',
    '/login.html',
    '/manifest.json',
    '/styles/variables.css',
    '/styles/components.css',
    '/styles/responsive-mobile.css',
    '/styles/animations.css',
    '/styles/pages/control-plane.css',
    '/styles/pages/activity.css',
    '/js/services/control-plane-service.js',
    '/js/services/data-repository.js',
    '/js/services/gunter-memory.js',
    '/js/services/personal-memory-service.js',
    '/js/services/connection-manager.js',
    '/js/services/web-node-runtime.js'
    ,'/js/controllers/activity-panel.js'
    ,'/js/core/workflow-orchestrator.js'
    ,'/styles/pages/conversations.css'
    ,'/styles/pages/social-settings.css'
    ,'/styles/pages/procedure-recorder.css'
    ,'/js/services/procedure-recorder.js'
    ,'/js/controllers/conversations-panel.js'
    ,'/js/controllers/social-settings-panel.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_STATIC).then(cache => {
            // addAll falla si UN solo recurso falla; usamos add individual con catch
            return Promise.all(PRECACHE_URLS.map(u =>
                cache.add(u).catch(err => console.warn('[sw] precache miss:', u, err.message))
            ));
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(names => Promise.all(
            names.filter(n => n.startsWith(CACHE_PREFIX) && !n.endsWith(SW_VERSION))
                 .map(n => caches.delete(n))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Bypass cross-origin (CDN, fonts, etc.) � deja que el navegador se encargue
    if (url.origin !== self.location.origin) return;

    if (LEGACY_PAGE_REDIRECTS[url.pathname]) {
        event.respondWith(Promise.resolve(Response.redirect(new URL(LEGACY_PAGE_REDIRECTS[url.pathname], self.location.origin), 302)));
        return;
    }

    // /api/* �  network-only (jamás cache)
    if (url.pathname.startsWith('/api/')) {
        return; // navegador hace fetch directo
    }

    // Navegación a HTML �  network-first con fallback al cache
    if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
        event.respondWith(networkFirstHtml(req));
        return;
    }

    // Assets estáticos (css/js/img/font) �  cache-first con SWR
    if (/\.(css|js|png|jpg|jpeg|svg|gif|webp|woff2?|ttf|eot|otf|ico)$/i.test(url.pathname)) {
        event.respondWith(cacheFirstSWR(req));
        return;
    }

    // Resto: pasa al navegador
});

async function networkFirstHtml(req) {
    const cache = await caches.open(CACHE_PAGES);
    try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
    } catch (err) {
        // Sin red �  busca en cache (la página solicitada o el shell)
        const cached = await cache.match(req) || await caches.match(req);
        if (cached) return cached;
        // �altimo fallback: dashboard del shell
        const shell = await caches.match('/dashboard.html');
        if (shell) return shell;
        return new Response(
            `<!doctype html><meta charset="utf-8"><title>Sin conexión</title>
             <style>body{font-family:Inter,system-ui;background:#0b0f16;color:#e5e7eb;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px}h1{color:#00d4ff}</style>
             <h1>Sin conexión</h1><p>Gunter necesita conexión para abrir esta página por primera vez.</p>`,
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
    }
}

async function cacheFirstSWR(req) {
    const cache = await caches.open(CACHE_RUNTIME);
    const cached = await cache.match(req);
    const network = fetch(req).then(resp => {
        if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
        return resp;
    }).catch(() => null);

    if (cached) {
        // Revalidate in background; sirve el cache ya
        network.catch(() => {});
        return cached;
    }
    // No estaba en cache �  espera a la red
    const fresh = await network;
    if (fresh) return fresh;
    // �altimo: 504 silencioso
    return new Response('Asset no disponible offline', { status: 504, statusText: 'Offline' });
}

// Mensajes desde el cliente (para forzar update / clear cache desde la UI)
self.addEventListener('message', (event) => {
    const { type } = event.data || {};
    if (type === 'SKIP_WAITING') {
        self.skipWaiting();
    } else if (type === 'CLEAR_CACHE') {
        caches.keys().then(names => Promise.all(
            names.filter(n => n.startsWith(CACHE_PREFIX)).map(n => caches.delete(n))
        )).then(() => event.source?.postMessage?.({ type: 'CACHE_CLEARED' }));
    }
});

self.addEventListener('push', event => {
    let payload = {};
    try { payload = event.data?.json?.() || {}; } catch { payload = { body: event.data?.text?.() || '' }; }
    const priority = ['high', 'urgent'].includes(payload.priority) ? payload.priority : 'normal';
    const options = {
        body: String(payload.body || 'Tienes una actualización pendiente.').slice(0, 500),
        tag: String(payload.tag || 'gunter-update').slice(0, 120),
        icon: '/assets/gunter/gunter_transparent_alert_1769134280215.png',
        badge: '/assets/gunter/gunter_transparent_default_1769134184933.png',
        renotify: priority !== 'normal', requireInteraction: priority === 'urgent',
        silent: priority === 'low', data: { url: safeNotificationUrl(payload.url), ...(payload.data || {}) }
    };
    event.waitUntil(self.registration.showNotification(String(payload.title || 'Gunter').slice(0, 100), options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL(safeNotificationUrl(event.notification.data?.url), self.location.origin).href;
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        const existing = clients.find(client => new URL(client.url).origin === self.location.origin);
        if (existing) return existing.focus().then(() => existing.navigate(target));
        return self.clients.openWindow(target);
    }));
});

function safeNotificationUrl(value) {
    const raw = String(value || '/day.html#reminders');
    return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/day.html#reminders';
}
