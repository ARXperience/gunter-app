# Identidad, ingreso y comunicación contextual

El perfil autenticado conserva `displayName` (nombre de registro) y
`preferredName` (cómo dirigirse al usuario). El registro deriva el primer nombre
identificable; los identificadores de acceso y los correos no se convierten en
nombres. Un nombre preferido vacío explícito permanece vacío. `POST /api/auth/profile`
solo modifica nombres de la cuenta autenticada; no cambia credenciales ni sesiones.
Las pestañas invalidan su caché y vuelven a consultar el perfil, sin compartir PII
por BroadcastChannel/storage.

`POST /api/auth/entry` coordina la bienvenida en el almacén de sesiones existente.
Una nueva sesión o una reapertura después de abandonar todas las páginas inicia
un ingreso. La navegación interna, recarga, apertura del chat y actualización de
perfil continúan el ingreso existente. La reclamación es síncrona en el servidor,
también con varias pestañas. Cada documento mantiene una presencia de 30 segundos
y la libera con pagehide. Para cierres abruptos sin pagehide hay una tolerancia
de 120 segundos: reabrir antes de expirar puede continuar el ingreso anterior.
No se crea ningún almacén adicional.

Presence calcula nombre autorizado, zona horaria, período (incluida madrugada),
día y actividades propias verificadas. El LLM configurado redacta solo la pregunta
final, sin nombres, cifras ni afirmaciones de acontecimientos. Si no está disponible
se conserva una bienvenida factual. El saludo escrito y hablado tienen controles
independientes; apagar el saludo consume el ingreso para evitar reproducción tardía.

La personalidad sigue una única política para complete y streaming. El humor
contextual se omite en situaciones delicadas, diagnóstico y explicación técnica.
No hay bromas cada N turnos ni cambio obligatorio de carácter por el mood.

## Fuente realmente leída

`standupspeakoutoerpdf.pdf` corresponde a *Stand up, Speak out: The Practice and
Ethics of Public Speaking*, University of Minnesota Libraries Publishing (2016),
no a un manual de stand-up. Se consultaron secciones 4.4, 5.2, 9.2, 13.2, 18.1 y
18.3 (en particular páginas PDF 520–523).

Principios sintetizados, sin copiar chistes ni rutinas: comprender y evaluar antes
de responder; adecuar lenguaje al propósito, tema, audiencia y ocasión; claridad
y vocabulario familiar; observación contextual/personalización; apartes y contraste
verbal (incluido oxímoron); brevedad; ritmo y énfasis; remate al final sin anunciar;
no explicar una broma fallida; saber cuándo dejar de bromear.

Pruebas focalizadas: `auth-profile`, `entry-context`, `context-personality`,
`local-wake-browser`, `default-activation`, `presence-voice`. La naturalidad subjetiva
de saludos y humor requiere escucha humana; las pruebas verifican contexto,
preferencias, límites y aislamiento, no una garantía perceptual del LLM.
