/* =============================================
   GUNTER - Service Worker (Fase 8)
   -------------------------------------------------
   Estrategias por tipo de request:
     /api/*                  → network-only (jamás cachear; APIs vivas)
     navegación HTML         → network-first, fallback al cache,
                               último fallback offline.html
     assets estáticos        → cache-first con revalidación en background
     opaco / cross-origin    → bypass (no interfiere)

   Versionado: bumpear SW_VERSION para invalidar todo el cache.
   ============================================= */

const SW_VERSION = 'v1.0.0';
const CACHE_PREFIX = 'gunter-';
const CACHE_STATIC = `${CACHE_PREFIX}static-${SW_VERSION}`;
const CACHE_PAGES  = `${CACHE_PREFIX}pages-${SW_VERSION}`;
const CACHE_RUNTIME = `${CACHE_PREFIX}runtime-${SW_VERSION}`;

// Shell mínimo precacheado en install — solo lo que garantiza
// que el visualizador básico levante offline.
const PRECACHE_URLS = [
    '/',
    '/dashboard.html',
    '/day.html',
    '/meeting.html',
    '/config.html',
    '/results.html',
    '/index.html',
    '/manifest.json',
    '/styles/variables.css',
    '/styles/components.css',
    '/styles/responsive-mobile.css',
    '/styles/animations.css'
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

    // Bypass cross-origin (CDN, fonts, etc.) — deja que el navegador se encargue
    if (url.origin !== self.location.origin) return;

    // /api/* → network-only (jamás cache)
    if (url.pathname.startsWith('/api/')) {
        return; // navegador hace fetch directo
    }

    // Navegación a HTML → network-first con fallback al cache
    if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
        event.respondWith(networkFirstHtml(req));
        return;
    }

    // Assets estáticos (css/js/img/font) → cache-first con SWR
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
        // Sin red → busca en cache (la página solicitada o el shell)
        const cached = await cache.match(req) || await caches.match(req);
        if (cached) return cached;
        // Último fallback: dashboard del shell
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
    // No estaba en cache → espera a la red
    const fresh = await network;
    if (fresh) return fresh;
    // Último: 504 silencioso
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
