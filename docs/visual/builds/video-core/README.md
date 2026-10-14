# Núcleo de video integrado

## Decisión

Aplicación existente: HTML/CSS/JavaScript sin framework de UI, servidor Node.js.
La voz seleccionada continúa siendo Supertonic 3 M1: `/api/tts` devuelve audio que
`voice-service.js` reproduce con HTMLAudio. No se cambia generación, voz ni modelo.

Tesis visual: conservar la materia orgánica del video del usuario y añadir una
geometría fina, opcional, sin sustituirla por partículas calculadas. El espacio
sigue siendo el mapa operativo existente y su chat, no una landing nueva.
Movimiento: metraje continuo; seguimiento amortiguado del puntero; expansión y
brillo derivados únicamente de amplitud medida. Sin Three.js, shaders ni paquetes
nuevos. Se reutilizó FFmpeg instalado; Mediabunny no estaba instalado y no se añadió.

## Integración

- `GunterParticles.mount()` mantiene su API y selectores. Ahora monta video nativo
  y SVG, en lugar del generador Canvas anterior. Máximo dos videos visibles; los
  avatares pequeños comparten el póster local. Ocultar, desmontar, cambiar de página
  o reducir animaciones pausa el video y apaga el análisis visual.
- Bucle local de 16,27 s, H.264 Main/YUV420P, 576×720, 6.323.336 bytes, sin audio.
  Fundido de 0,75 s para suavizar la unión. Procedencia: `assets/gunter/CORE_VIDEO.md`.
- Recoloración por hue-rotate/saturate: mantiene humo y luces neutrales, sin cuatro
  copias del video. Flor de la Vida de 19 círculos o Cubo de Metatrón de 13 nodos;
  son recursos visuales, no afirmaciones sobre efectos físicos o inteligencia.
- Estados: reposo, captura realmente activa, procesamiento y reproducción real.
  Preparar audio no equivale a estar hablando; se conserva la bandera de cola
  interna y se expone `pending` en la consulta de reproducción.
- Voz: contexto Web Audio desbloqueado por gesto, HTMLAudio → AnalyserNode → salida
  única. Si no se pudo desbloquear antes, se conserva reproducción nativa y se
  intenta una toma captureStream cuando exista. Sin señal: available:false y nivel0.
  speechSynthesis no proporciona PCM al analizador: no se inventan pulsaciones.
- Micrófono: observación del analyser/VAD compartido ya autorizado, sin otro
  getUserMedia ni conectar la entrada a los altavoces. RMS como máximo30Hz; señal
  caduca a250ms, se limpia al cancelar/parar/fallar/perder la captura.
- `server.js` añade rangos de bytes para MP4 al servidor público existente:
  206/416, HEAD y liberación del stream al cerrar. No se amplían rutas privadas.
- Service Worker versionado; CSS y póster disponibles como shell. No se fuerza
  precarga del MP4 de6MB al instalar. Si el archivo no está disponible se conserva
  el póster, no una animación sintética. Con servidor local, el video no requiere red externa.

## Parámetros

Configuración → Apariencia y accesibilidad → Núcleo visual. Persistencia en el
objeto existente `gunter_prefs.coreVisual`, solo al cambiar un control; se conservan
las demás preferencias. Es apariencia del dispositivo, no otro perfil personal.

| Campo | Predeterminado | Rango/opciones |
| --- | --- | --- |
| color | #8b6cff | hexadecimal; presets azul/violeta/verde/rojo |
| size | 1 | 0,7–1,3 |
| mouseSensitivity | 0,65 | 0–1,5; touch no interfiere con scroll |
| voiceIntensity | 1 | 0–2; cero desactiva el análisis visual |
| geometry | flower | flower / metatron / none |
| geometryOpacity | 0,12 | 0–0,4 |

API para integraciones existentes: `getConfig()`, `getDefaults()` y
`configure(patch, { persist: true })`. Normaliza tipos/rangos/color y no admite URLs.

## Validación focalizada

- core-renderer:23; core-audio-levels:10; core-video-http:10, aprobadas.
- UI contracts y17 contratos de espacios orbitales aprobados.
- Un único smoke general:139 aprobadas,0 fallos, con almacenamiento aislado.
- Navegador: video real decodificando y en bucle, edición por controles nativos,
  persistencia al recargar, reset, geometría, oscuro/claro y movimiento reducido.
  Inicio 1440×1000 y390×844 sin scroll añadido; un decoder activo en el móvil emulado.
- Audio de prueba: WAV sintético reproducido por el pipeline real HTMLAudio/WebAudio,
  no una generación TTS. RMS bajo0,056 y alto0,353, escala1,027→1,120; al cancelar,
  nivel0 y fuente inactiva. Entrada: stream de prueba Web Audio compartido con VAD,
  RMS máximo0,142, sin llamadas adicionales a getUserMedia. No se grabó al usuario.
- No benchmarks, cambios de modelos, pruebas de calidad de voz ni despliegue.

Pendiente: Safari/iOS/Android físicos y permisos del dispositivo real. La política
de autoplay puede exigir interacción; se muestra el póster y se reintenta tras un
gesto, sin iniciar captura. Referencia técnica:
[MDN autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).
Antes de distribución pública debe verificarse el derecho a redistribuir el video
adjunto. No se presenta el material como una creación propia ni con licencia MIT.

Capturas locales: `output/playwright/core-video-*.png`. Reversión sin migraciones:
revertir este commit y actualizar caché; las preferencias adicionales son opcionales.
