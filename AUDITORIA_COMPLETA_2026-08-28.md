# Auditoría completa de Gunter App

Fecha: 2026-08-28  
Alcance: código activo de cliente y servidor, autenticación, API, PWA, seguridad, dependencias, ejecución en navegador, responsive, accesibilidad, rendimiento, pruebas y mantenibilidad.  
Exclusiones: `_backups/`, `_archive/`, `backups/`, `node_modules/` y `solidworks-mcp/` no se analizaron como código de producción, salvo para medir deuda y superficie expuesta.  

> Esta es una revisión técnica interna, no una certificación formal ni una prueba de penetración externa. No se copiaron secretos al informe.

## Estado de remediación — 2026-08-28

Los bloqueos técnicos P0/P1 identificados durante esta auditoría fueron corregidos
en el árbol de trabajo: allowlist estática, cabeceras y CORS, rate limiting, límite
de payload, sesiones sólo por cookie, token de servicio rotado, mitigación de XSS,
errores de runtime y onboarding móvil. La validación posterior obtuvo **86/86
smoke tests**, **0 errores en Dashboard/Resultados con navegador real** y
**0 vulnerabilidades en `npm audit`**.

El veredicto histórico de abajo describe el estado encontrado antes de las
correcciones. Para un despliegue público aún se deben rotar desde sus respectivos
proveedores todas las credenciales externas que hubieran estado en `.env`,
configurar un proveedor de IA y repetir las mediciones de rendimiento/accesibilidad
en el entorno de producción.

## Veredicto ejecutivo

**Estado de despliegue público: NO-GO.**

La app tiene una base funcional valiosa: autenticación con `scrypt`, sesiones opacas, aislamiento de datos por usuario, borrado de datos al eliminar usuarios, PWA operativa y 73 smoke tests de backend en verde. Sin embargo, hoy no debe exponerse a Internet porque el servidor está entregando archivos internos y secretos como contenido estático. También existen dependencias críticas vulnerables, XSS almacenado plausible y fallos JavaScript que rompen pantallas principales.

Puntuación heurística global: **51/100**.

| Área | Puntuación | Estado |
|---|---:|---|
| Seguridad | 15/100 | Bloqueo de despliegue |
| Funcionalidad | 58/100 | Backend estable; varias pantallas rotas |
| Rendimiento | 59/100 móvil dashboard | LCP 13,8 s |
| Accesibilidad | 88/100 móvil dashboard | Fallos de nombres, contraste y diálogo |
| UX y responsive | 72/100 | Buena base; onboarding móvil se recorta |
| PWA | 64/100 | SW funcional; iconos y caché requieren corrección |
| Pruebas | 38/100 | Smoke amplio, sin runner autónomo ni pruebas UI |
| Mantenibilidad | 42/100 | 62.601 líneas activas, duplicación y archivos monolíticos |

La puntuación es una herramienta de priorización, no un estándar externo.

## Hallazgos P0 — corregir antes de cualquier despliegue

### SEC-01 — Exposición pública de secretos y archivos internos

**Severidad: crítica. Confirmado en ejecución.**

`server.js:1377-1440` convierte cualquier ruta no API en una ruta de disco y la sirve sin limitarla a una carpeta pública ni aplicar una allowlist. Se confirmó respuesta HTTP 200 para:

- `/.env`
- `/data/users.json`
- `/data/service-token.json`
- `/server.js`
- `/.git/config`

Impacto: robo de claves de proveedores, token de servicio con privilegios administrativos, hashes y metadatos de usuarios, sesiones, código fuente y configuración Git. El token de servicio permite saltar la autorización normal (`server/auth/index.js:83`, `server/auth/index.js:106`).

Corrección:

1. Mover los recursos públicos a un directorio `public/` y servir exclusivamente archivos cuya ruta resuelta permanezca dentro de ese directorio.
2. Denegar explícitamente archivos y carpetas que empiecen por `.`, además de `data/`, `server/`, `backups/`, `_backups/`, `whatsapp-*`, `tutor-library/`, `test/`, `scripts/`, `package*.json` y archivos de configuración.
3. Tras corregir el servidor, rotar **todas** las claves presentes en `.env`, regenerar el token de servicio y destruir todas las sesiones actuales. Tratar las credenciales actuales como comprometidas.
4. Añadir tests que exijan 404/403 para cada ruta sensible.

Criterio de cierre: ninguna ruta arbitraria fuera de `public/` devuelve contenido; un test automatizado cubre traversal codificado y rutas sensibles.

### SEC-02 — Dependencias con vulnerabilidades críticas y altas

**Severidad: crítica. Confirmado con `npm audit --omit=dev`.**

Resultado: 6 paquetes vulnerables: 2 críticos, 3 altos y 1 moderado.

- `@whiskeysockets/baileys` 7.0.0-rc.9: vulnerabilidad crítica de spoofing/corrupción; la versión instalada cae en el rango afectado `<7.0.0-rc12`.
- `protobufjs`: ejecución de código, inyección, prototype pollution y DoS en versiones transitivas afectadas.
- `ws`: agotamiento de memoria/DoS.
- `sharp`: vulnerabilidades heredadas de libvips.
- `@protobufjs/utf8`: decodificación UTF-8 no canónica.

`npm outdated` indica Baileys 7.0.0-rc14 disponible. Todas las vulnerabilidades reportaron `fixAvailable: true`.

Corrección: actualizar dependencias en una rama separada, ejecutar smoke tests, reconectar una sesión de WhatsApp de prueba y repetir `npm audit`. Añadir auditoría de dependencias al CI y bloquear severidad alta/crítica.

### SEC-03 — XSS almacenado en tarjetas de proyectos

**Severidad: crítica/alta según exposición. Confirmado por revisión de flujo.**

`dashboard.html:315-349` interpola directamente `project.name`, `project.market`, `summary` y `project.id` dentro de `innerHTML` y atributos `onclick`. Los datos proceden del almacenamiento del usuario y pueden contener HTML o romper el atributo JavaScript.

Impacto: ejecución persistente de JavaScript en el origen de la app. Aunque la cookie es `HttpOnly`, un XSS puede realizar acciones autenticadas, leer datos visibles y acceder a cualquier recurso expuesto por SEC-01.

Corrección:

- Construir nodos con `createElement`, `textContent`, `dataset` y `addEventListener`.
- Si se mantiene HTML templado, escapar por contexto: texto HTML, atributo HTML y cadena JavaScript requieren escapes distintos. No usar `onclick` inline.
- Aplicar la misma revisión a los 265 usos activos de `innerHTML`, priorizando contenido de usuario, transcripciones y respuestas de IA en `results.html`, `meeting.html` y controladores.
- Incorporar una política CSP sin `unsafe-inline` después de retirar scripts y handlers inline.

## Hallazgos P1 — alta prioridad

### RUN-01 — Dashboard, reunión y resultados tienen errores JavaScript fatales

**Severidad: alta. Confirmado en navegador real.**

- `js/gunter-avatar.js:6` y `js/app.js:229` declaran `class GunterAvatar` en el mismo scope global, causando `Identifier 'GunterAvatar' has already been declared`.
- `dashboard.html:257-261` carga `gunter-avatar.js` con `defer`, pero el script inline usa `GunterAvatar` inmediatamente. Resultado: `GunterAvatar is not defined`.
- `results.html:448` y `results.html:472` declaran dos veces `const projectId` dentro del mismo callback. Todo ese bloque deja de ejecutar.
- `results.html:1537-1540` carga `pdf-exporter.js` con `defer` y usa `GunterPDFExporter` en el script inline siguiente, antes de que esté disponible.

Prueba móvil de 8 pantallas:

| Pantalla | Resultado |
|---|---|
| `index.html` / `dashboard.html` | 2 errores fatales de avatar |
| `day.html` | Sin errores detectados |
| `new-project.html` | Recurso 404 |
| `meeting.html` | Clase duplicada + recurso 404 |
| `results.html` | 3 errores de código + recurso 404 |
| `config.html` | Sin errores detectados |
| `admin.html` | Sin errores detectados |

Corrección: conservar una sola implementación de `GunterAvatar`; inicializar dependencias dentro de `DOMContentLoaded` o mediante módulos ES; eliminar el `projectId` duplicado; cargar el exportador antes de usarlo. Añadir un test de consola que falle ante cualquier `pageerror`.

### SEC-04 — Sin cabeceras de seguridad

**Severidad: alta. Confirmado por cabeceras HTTP.**

Las páginas no envían CSP, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, HSTS, `Referrer-Policy` ni `Permissions-Policy` (`server.js:1432-1439`). Tampoco hay una política de caché explícita para HTML y activos normales.

Corrección mínima:

- `Content-Security-Policy` con `default-src 'self'`, allowlist de CDN/proveedores y migración progresiva fuera de scripts inline.
- `X-Content-Type-Options: nosniff`.
- `frame-ancestors 'none'` en CSP.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` restringiendo cámara, micrófono y geolocalización a lo necesario.
- HSTS únicamente cuando todo el despliegue use HTTPS.

### SEC-05 — CORS abierto por defecto y confianza en `X-Forwarded-For`

`server.js:100-130` usa `Access-Control-Allow-Origin: *` si `ALLOWED_ORIGINS` no está configurado. `server/auth/index.js:36-39` confía en `X-Forwarded-For` sin validar que la petición venga de un proxy de confianza, permitiendo evadir el rate limit mediante spoofing en despliegues directos.

Corrección: fallar el arranque en producción si no hay allowlist; rechazar orígenes no permitidos en lugar de devolver el primer origen; confiar en cabeceras de proxy solo detrás de un proxy configurado; limitar también por cuenta y por subred.

### SEC-06 — Endpoints costosos sin límites homogéneos de cuerpo o tasa

Solo `/api/transcribe` controla tamaño (`server.js:233-260`) y acepta hasta 200 MB en memoria. Muchos endpoints JSON concatenan chunks sin límite, por ejemplo `server.js:371-379`, `server.js:430-438`, `server.js:511-520` y `server.js:1290-1304`.

Impacto: agotamiento de memoria y consumo abusivo de cuota de IA/TTS. El servidor usa un solo proceso y numerosos accesos síncronos a disco, amplificando el bloqueo.

Corrección: helper único `readJsonBody(req, { maxBytes })`, rechazo temprano por `Content-Length`, límite por streaming, rate limit por usuario/IP/end-point, cuotas de costo y timeouts de proveedores. Reducir el límite de audio o transmitirlo a disco/proveedor sin mantener 200 MB por petición en RAM.

### AUTH-01 — Token de sesión también se devuelve en JSON

`server/auth/index.js:154-158` y `server/auth/index.js:174-178` colocan el token tanto en cookie `HttpOnly` como en el cuerpo JSON. El cliente no necesita leerlo si opera con cookie; devolverlo amplía el impacto de XSS, extensiones y logs de depuración.

Corrección: devolver solo el usuario y estado; mantener el token exclusivamente en cookie `HttpOnly; Secure; SameSite=Lax/Strict`. Invalidar todas las sesiones al cambiar contraseña, no solo en reset administrativo.

### AUTH-02 — Bootstrap del primer administrador es inseguro si el sistema arranca expuesto

`server/auth/store.js:111-124` convierte el primer registro en admin aprobado. Si una instancia nueva es alcanzable antes del propietario, un atacante toma control.

Corrección: requerir un secreto de bootstrap de un solo uso, comando local, variable de entorno temporal o creación de admin por CLI. Desactivar registro público hasta terminar el setup.

## Hallazgos P2 — calidad, UX, accesibilidad y rendimiento

### PERF-01 — Dashboard móvil: 59/100 y LCP de 13,8 s

Lighthouse móvil autenticado:

| Métrica/categoría | Resultado |
|---|---:|
| Performance | 59/100 |
| Accessibility | 88/100 |
| Best Practices | 96/100 |
| SEO | 100/100 |
| LCP | 13,8 s |
| Main thread | 5,4 s |
| Transferencia inicial | 1.776 KiB |
| CSS no usado estimado | 239 KiB |
| JS no usado estimado | 85 KiB |
| Caché potencial | 1.100 KiB |

Problemas concretos:

- Imagen principal de Gunter: 635 KiB y 1024×1024 para usos mucho menores.
- `gunter-legacy-overrides.css` se solicita dos veces, con y sin query string: 171 KiB cada vez.
- `gunter-design-system.css` también se duplica.
- Los activos normales no tienen `Cache-Control`.
- El dashboard carga servicios grandes aunque no se usen de inmediato.

Corrección: variantes AVIF/WebP responsivas, `width`/`height`, preload solo del LCP real, eliminar cargas duplicadas, separar CSS por página, lazy-load del asistente/tutor/voz y caché inmutable para activos versionados.

### A11Y-01 — Navegación y diálogo sin nombre accesible

Lighthouse marca:

- Los 4 enlaces principales de `.sidebar__nav` sin nombre discernible (`dashboard.html:61-96`). Verificar la regla que está ocultando sus `<span>` del árbol accesible y añadir `aria-label` explícito si se mantiene el comportamiento.
- Un diálogo sin nombre accesible; usar `aria-labelledby` apuntando a su título.
- Contraste insuficiente en `.sidebar__user-avatar`.

### A11Y-02 — Controles interactivos no semánticos

- `login.html:148` y `login.html:176`: enlaces sin `href`; no entran correctamente en navegación por teclado. Deben ser `<button type="button">` o enlaces reales.
- `dashboard.html:323`: `<div onclick>` para abrir un proyecto; debe ser enlace o botón con teclado.
- `results.html:729`: fase del roadmap con `<div onclick>` sin alternativa de teclado ni estado `aria-expanded`.

### A11Y-03 — Focus y motion inconsistentes

Se encontraron 20 reglas `outline: none` y 94 `transition: all` en código activo. Algunas tienen reemplazo de foco, otras dependen de overrides globales difíciles de razonar. `transition: all` puede animar propiedades de layout y degrada rendimiento. Auditar por componente y usar `:focus-visible`; listar solo `transform`, `opacity`, `border-color` o `box-shadow` según corresponda.

### UX-01 — Onboarding recortado en móvil

En 390×844, el onboarding inicial aparece desplazado fuera del viewport y recorta título, texto y acciones. Después de saltarlo, el dashboard sí evita overflow horizontal. El asistente flotante también se superpone a contenido y tarjetas.

Corrección: modal con `max-width: calc(100vw - 32px)`, `max-height`, scroll interno, safe areas, `overscroll-behavior: contain`, centrado por grid y pruebas en 320/390/430 px.

### UX-02 — Densidad y legibilidad

- La fuente pixelada refuerza identidad, pero reduce legibilidad en párrafos, formularios y números. Reservarla para marca/títulos; usar una sans legible para contenido y controles.
- `config.html` mide ~9.717 px de alto en móvil y contiene 172 botones. Requiere navegación por secciones, búsqueda, estados colapsables y deep links.
- El dashboard muestra ceros acompañados por un glifo similar a batería, confundible como unidad o estado.

### PWA-01 — Manifest e iconos inconsistentes

`manifest.json:20-32` declara que cada archivo raster contiene 192, 256, 384, 512 y 1024 px, pero los archivos medidos son 1024×1024. Además, `gunter_default_1769130911628.png` contiene datos JPEG pese a la extensión y `type: image/png`.

Corrección: exportar archivos reales por tamaño, MIME y propósito; incluir un icono maskable auténtico con zona segura; añadir screenshots al manifest. Evitar descargar 635–763 KiB para iconos pequeños.

### PWA-02 — Estrategia offline puede conservar shell autenticado

`service-worker.js:22-35` precachea todas las páginas de aplicación. `networkFirstHtml` puede mostrar el dashboard cacheado cuando la validación de sesión no está disponible. Los datos locales siguen en el dispositivo, pero la UX puede presentar una sesión aparentemente activa o contenido desactualizado.

Corrección: definir explícitamente la experiencia offline, no cachear vistas sensibles si no se puede verificar sesión, y limpiar cachés/datos de usuario al cerrar sesión o cambiar de usuario.

### QUAL-01 — Arquitectura monolítica y duplicación

Código activo medido: 220 archivos JS/HTML/CSS y 62.601 líneas.

Archivos de mayor deuda:

- `styles/gunter-legacy-overrides.css`: 4.154 líneas.
- `js/controllers/tutor-panel.js`: 1.839 líneas.
- `server.js`: 1.526 líneas.
- `results.html`: 1.401 líneas y lógica inline extensa.
- `js/advanced-settings.js`: 1.325 líneas.
- `js/services/gunter-companion.js`: 1.208 líneas.

Hay 94 `transition: all`, 265 `innerHTML`, scripts concatenados en una sola línea y múltiples capas de CSS base/override. Esto explica colisiones globales y regresiones.

Corrección: router HTTP por módulos, componentes ES module, cero lógica de dominio inline en HTML, una sola capa de design tokens, lint/format y límites de tamaño por archivo.

### QUAL-02 — Backups dentro del repositorio

`_backups/` contiene 176 archivos y `backups/` 265. Muchos backups históricos están versionados en Git. Aumentan ruido de búsqueda, riesgo de editar código obsoleto y superficie expuesta por SEC-01.

Corrección: conservar historia en Git, releases o almacenamiento externo; sacar backups del árbol servido y del análisis normal.

### TEST-01 — El comando de pruebas no es autónomo

`test/smoke.js:4-8` exige que el servidor ya esté corriendo. En entorno limpio, `npm test` falla con “Server no responde”; con el servidor iniciado, pasa **73/73**.

Corrección: usar un test runner que arranque el servidor en puerto efímero, espere `/api/health`, ejecute y cierre el proceso. Añadir pruebas de seguridad, UI y regresión.

Cobertura mínima recomendada:

1. Acceso negado a archivos internos y traversal.
2. Auth: bootstrap seguro, cookies, logout, cambio de contraseña e invalidación.
3. Rate/body limits y respuestas ante payload grande.
4. Navegación de las 8 pantallas sin `pageerror` ni errores de consola.
5. XSS con nombres, mercados y transcripciones maliciosas.
6. 320/390/430/768/1440 px y teclado completo.
7. Instalación/actualización/offline de la PWA.

## Fortalezas verificadas

- 73 smoke tests pasan con el servidor activo.
- Contraseñas con `crypto.scrypt`, salt aleatorio y `timingSafeEqual` (`server/auth/store.js:55-66`).
- Tokens opacos de 32 bytes aleatorios (`server/auth/sessions.js:90-103`).
- Cookie `HttpOnly`, `SameSite=Lax` y `Secure` configurable/detectado por proxy (`server/auth/index.js:118-124`).
- Rate limit de login y registro, aunque necesita endurecimiento.
- Guard global para `/api/*`, con excepciones explícitas de health/auth (`server.js:224-231`).
- Aislamiento por usuario probado: el propietario no vio datos del usuario de prueba.
- Borrado de datos y sesiones al eliminar usuario probado.
- Todas las rutas críticas y activos del smoke test respondieron.
- UTF-8 y tildes del contenido principal pasaron el smoke test.
- Login: Lighthouse 100/100 en accesibilidad, 84/100 performance móvil y 98/100 escritorio.
- Dashboard posterior al onboarding no mostró overflow horizontal a 390 px.

## Plan de remediación recomendado

### Fase 0 — contención inmediata (mismo día)

1. No publicar ni abrir el puerto fuera de localhost/VPN.
2. Corregir SEC-01 con raíz pública cerrada.
3. Rotar secretos, token de servicio y sesiones.
4. Actualizar Baileys y transitivas vulnerables.

### Fase 1 — estabilidad y seguridad (1–3 días)

1. Corregir los 4 fallos JavaScript fatales.
2. Eliminar XSS del dashboard y superficies de resultados/transcripción.
3. Añadir headers, límites de cuerpo, rate limits y allowlist CORS.
4. Convertir `npm test` en un flujo autónomo y añadir tests P0.

### Fase 2 — rendimiento, PWA y accesibilidad (3–7 días)

1. Quitar CSS/JS duplicado y lazy-load de servicios.
2. Optimizar imágenes y definir caché versionada.
3. Reparar navegación accesible, diálogo, contraste, foco y onboarding móvil.
4. Corregir manifest/iconos y probar instalación/offline.

### Fase 3 — reducción de deuda (iterativa)

1. Dividir `server.js`, `results.html`, Tutor y Configuración.
2. Migrar scripts globales a módulos.
3. Retirar overrides legacy y backups del repositorio activo.
4. CI con lint, tests, `npm audit`, Lighthouse budgets y test de consola.

## Puerta de salida para producción

No aprobar producción hasta cumplir todos estos puntos:

- 0 rutas internas o secretas accesibles por HTTP.
- 0 vulnerabilidades críticas/altas conocidas en producción.
- 0 errores de consola o `pageerror` en las 8 pantallas principales.
- Pruebas XSS negativas en proyectos, transcripciones y respuestas de IA.
- CSP, `nosniff`, política de frame, referrer y permisos activas.
- Límite de cuerpo y tasa en todos los endpoints costosos.
- Lighthouse móvil objetivo: Performance ≥80, Accessibility ≥95, LCP ≤2,5 s en red representativa.
- Flujo completo de teclado y responsive 320–1440 px.
- Smoke + seguridad + UI ejecutables con un solo comando y verdes en CI.

## Evidencias generadas

Artefactos locales en `output/playwright/`:

- Screenshots de login y dashboard en escritorio/móvil.
- `lighthouse-login-mobile.json`
- `lighthouse-login-desktop.json`
- `lighthouse-dashboard-mobile.json`

La revisión de interfaz se contrastó con las Web Interface Guidelines de Vercel: https://github.com/vercel-labs/web-interface-guidelines
