# Núcleo generado — fase 2, candidato visual

Componente WebGL2 reutilizable, sin Three.js ni dependencias nuevas. El MP4 de
TouchDesigner se usa exclusivamente para comparar: no se carga ni reproduce
dentro del núcleo. No se modifica la navegación ni el diseño del dashboard.

## Simulación y luz

Dos texturas RGBA32F alternadas conservan 1.280 curvas materiales de 96 puntos.
Cada punto avanza mediante advección RK2 en un campo de velocidad con tres escalas
de curl noise. Las restricciones entre vecinos limitan el estiramiento sin
convertir las curvas en colas de partículas. Se dibujan hasta cuatro fibras finas
por curva mediante triángulos instanciados, no sprites de puntos.

Un emisor grueso, curvo y continuo transporta una pulsación que no se apaga en
focos separados. Su campo de transporte también interviene en la advección de
las fibras. Una distribución tridimensional de materia plegada añade capas
densas, poros y cavidades dentro de una envolvente deformada, no una esfera llena.

Un atlas RGBA16F de 48³ celdas (384 × 288, unos 0,84 MiB) guarda densidad,
energía, irradiancia interna y orientación de las caras. Se calcula una vez por
fase/densidad y lo comparten volumen y filamentos, también entre avatares.
Cambiar color, brillo, tamaño o resolución no lo reconstruye ni reinicia la
advección. La integración de 40 muestras al 75 % de resolución aproxima absorción
Beer–Lambert, dispersión simple y emisión; capas delanteras ocultan parcialmente
las posteriores. El grano tridimensional es continuo; la estratificación de los
rayos es fija, sin ruido aleatorio por frame. Bloom separado de dos pasos y
composición HDR controlan el brillo. La salida RGBA premultiplicada mantiene
transparentes el fondo y los bordes, también sobre fondos claros.

### Refinamiento de microestructura

Las curvas iniciales tienen distintas longitudes y pliegues, sin un giro común
dominante. El shader produce cortes suaves, grosor subpíxel variable y cobertura
granular ligados a coordenadas materiales; el grano viaja con las fibras en vez
de renovarse aleatoriamente cada frame. No se añaden sprites ni más filamentos.

El campo lento circula a gran escala; otros dos campos evolucionan más rápido y
pliegan las hebras. Una componente convergente/divergente leve modifica su
espaciado. La cobertura crece selectivamente en zonas densas, con alfa limitado,
sin elevar uniformemente la transparencia o el brillo de toda la figura.

La luz procede del emisor interno, con absorción aproximada hacia él mediante
tres muestras de materia. Las caras y fibras reutilizan esa irradiancia y
reciben un tinte energético local. Los filamentos ponderan su alfa por la
extinción y profundidad ya integradas, en vez de oscurecer solo el RGB y dejar
trazos negros opacos sobre la energía. Se añade un único framebuffer fijo para
el atlas; no se evalúa el campo procedural completo en cada fragmento de fibra.
La extinción de fibras es una aproximación por columna, no auto-sombra geométrica
exacta ni dispersión múltiple físicamente completa.
El mapeo HDR conserva las proporciones cromáticas al comprimir el pico de
energía; no blanquea cada canal por separado ni cambia los HEX configurados.

La densidad cambia realmente los filamentos dibujados: 640 al 25 %, 2.560 al
100 % y 5.120 al 200 %, con 95 segmentos cada uno. El estado GPU se comparte:
cambiar densidad o tamaño no reinicia el material. Los pequeños avatares capturan
la fase actual sin hacer retroceder el compositor compartido.

## Integración y preferencias

Cargar `js/components/gunter-idle-core.js`, `js/services/gunter-particles.js` y
`styles/gunter-idle-core.css`. El montado de `data-gunter-particles="hero"`,
`chat` o `thumb` y la API `GunterParticles` existente se conservan.

```js
GunterParticles.configure({
  particleColor: '#b8bec9', energyColor: '#ff452b', glowColor: '#ff6d35',
  brightness: 1, density: 1, speed: 1, size: 1
}, { persist: true });
```

Configuración → Apariencia → Núcleo generado permite editar los tres colores
mediante selector y HEX validado, brillo, densidad 25–200 %, velocidad y tamaño.
La vista previa cambia inmediatamente. Se utiliza exclusivamente
`gunter_prefs.coreVisual`, conservando otros campos y preferencias. El antiguo
`color` sigue siendo un alias de `energyColor`; las preferencias heredadas se
leen sin sobrescribirlas automáticamente. Un fallo de almacenamiento se informa
y no simula una configuración guardada.

Uso directo, sin montado:

```js
const core = new GunterIdleCore();
if (core.available) {
  core.renderTo(canvas, 512, 512, segundos, {
    particleColor: '#b8bec9', energyColor: '#ff452b', glowColor: '#ff6d35',
    brightness: 1, density: 1, speed: 1, size: 1
  });
}
core.dispose();
```

El tiempo es monotónico: otra vista no rebobina la advección. El montado integra
la velocidad en su reloj; pausa y reanudación no saltan de forma. Un salto
explícito de más de cuatro segundos en el uso directo reinicializa el material,
evitando recuperar miles de pasos en un único frame.

## Interacción interna del puntero

El contenedor, el canvas, la cámara y la envolvente no se trasladan ni escalan
por el mouse. Solo el emisor recibe un desplazamiento acotado de 0,24 unidades
en el plano de la vista, con respuesta críticamente amortiguada (8 rad/s).
Los pliegues próximos se deforman, la velocidad arrastra fibras y aumenta la
turbulencia local. El glow adicional depende del calor próximo a ese emisor,
no de un filtro uniforme aplicado al contenedor.

El wrapper observa `pointermove` pasivamente sobre vistas grandes elegibles;
no captura eventos ni bloquea enlaces o botones. En solapamientos prevalece la
vista menor. Miniaturas y touch no controlan la interacción. Al salir, la energía
retorna suavemente al reposo. Pausa, movimiento reducido, ocultación, desmontado
y BFCache limpian el estado; no se guardan coordenadas ni nuevas preferencias.
Todas las vistas reutilizan una sola inercia y el atlas existente, sin añadir
partículas, buffers o dependencias.

Uso directo: `core.setPointer(x, y, true)` acepta coordenadas de vista
normalizadas (Y positiva hacia arriba), limitadas radialmente al disco unidad.
`core.setPointer(0, 0, false)` libera con inercia; `core.resetPointer()` vuelve
inmediatamente a neutral. La integración ocurre solo en pasos nuevos de
advección, nunca por cada avatar ni por eventos del mouse.

## Validación y estado visual

Interacción interna (`v147-internal-pointer`): 18 contratos GPU y 34 del wrapper.
En navegador real se verificaron seguimiento, retorno, pausa, movimiento
reducido, clics y cajas DOM/canvas invariables. Comparando dos simulaciones a la
misma fase, la lectura GPU mostró desplazamiento de energía de 0,214 unidades
en X y deformación media interior de 0,059 frente a 0,009 exterior: no es una
traslación uniforme ni solo un cambio de color. Se conservaron los siete targets
y 2.560 filamentos base, alfa transparente y cero errores WebGL. No se trabajó
en audio ni se repitió el smoke general. La integración visual de Inicio se
comprobó a 1.440 y 390 px con las API aisladas: no es una regresión del backend
ni una prueba física de dispositivos móviles.

Iteración de masa y flujo (posterior a `30b0ea0`, renderer `v146-matter-flow`):

- Trece contratos GPU focalizados: atlas compartido, ausencia de feedback,
  densidad real, tres colores, caché por fase/densidad, fallos de asignación,
  restauración del contexto y liberación de los siete targets. No se repiten las
  suites de voz, preferencias o el smoke general: esos sistemas no cambiaron.
- Iteraciones A–I comparadas con fotogramas del MP4: se descartaron niebla
  uniforme, fibras negras, rojo desaturado y una variante de grano periódico.
  Se conservan 2.560 filamentos base; el volumen adicional viene de la materia
  intermedia, no de más partículas o de aumentar únicamente el bloom.
- Comprobación acotada en Radeon integrada / ANGLE D3D11: 12 renders con lectura
  síncrona GPU por configuración. A 512 px/100 %, mediana 11,5 ms y máximo 12,4 ms
  frente a 8,6/9,3 ms antes. A 720 px/200 %, 21/23,2 ms. Incluye envío, render,
  presentación y sincronización; no es un perfil GPU aislado ni garantiza fps
  con varias vistas o en teléfonos físicos. No hubo error WebGL.
- Dos segmentos finales (8–11 y 20–23 s), muestreados a 24 fps y comparados con
  los segmentos 12–15 y 30–33 s originales. Vista previa local:
  `output/playwright/gunter-core-phase2-mass-preview.mp4`; solo es un artefacto
  de comparación, no un recurso usado por el núcleo ni una medición de fps.
- Navegador nativo: tres HEX cambian el render, 640/2.560/5.120 fibras reales,
  fase detenida estable (diferencia máxima 1/255), fondo libre y alfa parcial
  sobre blanco/oscuro/degradado. Sin blancos recortados con alfa ≥16/255;
  17 píxeles casi invisibles de alfa 1–3/255 se cuantizan a blanco al
  des-premultiplicar la lectura de 8 bits. No son focos de luz opacos.
- Misma advección a 8, 38 y 68 s: 2.701 pasos sin reinicio ni colapso aparente.
  Inicio carga el nuevo asset a 1.440 y 390 px sin añadir scroll, errores de
  página ni solicitudes de video/TTS/STT. Se usaron datos y cuenta desechables.

Refinamiento anterior de microestructura (`30b0ea0`, no repetido):

- Once pruebas GPU focalizadas, incluyendo reutilización de la textura de volumen
  sin realimentación ni nuevos targets. Los controles y el almacenamiento no se
  modificaron; no se repiten sus suites ni el smoke anterior.
- Shaders compilados en navegador real, tres colores independientes, 640/2.560/
  5.120 filamentos reales, alfa y fondos blanco/oscuro/degradado. En el frame
  comprobado no hubo blancos recortados; al detener la fase, los resultados
  repetidos difieren como máximo un nivel de cuantización de 8 bits.
- Iteraciones visuales A–G: fragmentación/grano, luz/sombras (se rechazó una
  variante demasiado oscura), turbulencia multiescala, cobertura localizada y
  extinción reutilizada, y mapeo cromático del brillo. Cada etapa tiene
  fotogramas locales `phase2-micro-*`.
- Comparadas dos secuencias finales (8–11 y 20–23 s) con los segmentos 12–15 y
  30–33 s del MP4 original. Capturas de la misma advección a 8, 38 y 68 s,
  2.701 pasos GPU y ningún reinicio, mantienen extensión y textura sin colapso
  aparente. No se usaron benchmarks ni se generó voz.
- Vista previa de esta iteración:
  `output/playwright/gunter-core-phase2-micro-preview.mp4` (dos segmentos, no
  una grabación ininterrumpida de seis segundos, muestreados a 24 fps). El MP4
  no se usa en la app ni constituye una medición del frame rate del dispositivo.
- Carga final en Inicio a 1.440 y 390 px, sin scroll añadido, con el renderer
  `v145b-microvolume`, sin errores de página ni solicitudes de video/TTS/STT.

Validación de integración anterior, en `5b67cb2` (no repetida en esta iteración):

- 46 comprobaciones focalizadas: `test/core-renderer.js` (27),
  `test/idle-core-gpu.js` (10) y `test/core-visual-settings.js` (9).
- Un único smoke general final con almacenamiento desechable: 139 correctas,
  cero fallos. No se ejecutaron benchmarks ni se regeneró voz.
- Navegador real: compilación GLSL, advección sin realimentación de framebuffer,
  tres colores independientes, densidades reales, alfa transparente, movimiento
  progresivo, Inicio y Configuración a 1.440 y 390 px, HEX inválido, vista previa,
  persistencia al recargar, restablecimiento y pausa. Sin errores de página/WebGL
  ni solicitudes de video, TTS o STT durante esta comprobación aislada.
- Comparación visual de fotogramas y dos secuencias generadas (8–11 y 20–23 s)
  con los segmentos 12–15 y 30–33 s del MP4. Se corrigieron nube de puntos,
  bucles iniciales demasiado grandes, focos separados y sobreexposición blanca.
- Artefactos locales en `output/playwright/phase2-*` y
  `output/playwright/gunter-core-phase2-preview.mp4`; no son recursos de la app.

**La fidelidad visual de fase 2 no se declara cerrada.** Se recuperaron masa,
capas superpuestas y energía interna conectada, con sombras y rojo localizado.
La referencia todavía tiene crestas erosionadas más nítidas, pliegues más
espesos y transporte de materia menos suave. Esta simulación conserva velos
ligeros y un vacío inferior marcado en algunas fases. La difusión y el campo de
materia son aproximaciones procedurales, no una simulación de fluido completa.
Requiere revisión visual del usuario; no es una réplica del grafo TouchDesigner.

## Límites y reversión

- Apariencia idle con interacción interna de mouse; sin micrófono, audio ni estados del asistente.
  Los servicios de conversación, permisos, modelos y voz no se modifican.
- Requiere WebGL2 y `EXT_color_buffer_float`. Sin ese soporte se informa que el
  núcleo no está disponible y Gunter sigue funcionando; no se simula soporte con
  video o con la nube de puntos anterior. Teléfonos físicos aún no verificados.
- Máximo dos vistas grandes animadas, techo de 30 fps y resolución de 720 px;
  miniaturas estáticas. Velocidad cero, reducción de movimiento, pestaña oculta
  y vistas fuera de pantalla detienen la animación. Se liberan los recursos al
  salir y se recupera el contexto GPU si el navegador lo restablece.
- Versión anterior conservada en el commit
  `363a3f2886b0e0abbad0e1b261075aee91cf661c` y la etiqueta local
  `codex/core-v2-before-phase2`. Para revertir esta fase, revertir su commit
  completo: mantiene juntos renderer, preferencias compatibles y versiones de
  caché. No se mantienen dos motores activos en paralelo.
- Punto adicional antes del refinamiento de microestructura: commit
  `5b67cb2638285092bc1278fc1ab159d8d1abcf2c`, etiqueta local
  `codex/core-phase2-before-microstructure`. Esta iteración también se revierte
  como commit completo, con sus referencias y versión de caché.
- Punto anterior a masa/flujo: commit
  `30b0ea00966d6499c5d05568f6f779a0eeeca7c3`, etiqueta local
  `codex/core-phase2-before-volume`. Revertir el commit completo de esta
  iteración restaura también sus URLs y versión de caché, sin cambiar preferencias.
- Antes de la interacción interna: commit `f7c85a7cd30a4e55a02aa613a31ebf3e2e9153d6`,
  etiqueta local `codex/core-before-internal-pointer`.
