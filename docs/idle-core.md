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

Un único volumen energético deformado y continuo determina tanto la emisión
interna (integración de 20 muestras a media resolución) como la iluminación de
los filamentos por proximidad. El movimiento de ese campo desplaza la luz; no se
añaden focos esféricos independientes. Bloom separado de dos pasos y composición
HDR controlan el brillo. La salida RGBA premultiplicada mantiene transparentes
el fondo y los bordes, también sobre fondos claros.

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

## Validación y estado visual

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

**La fidelidad visual de fase 2 no se declara cerrada.** El resultado tiene hebras
continuas y una silueta irregular, pero sus haces aún son más lisos, y la energía
más central, que en la referencia. No reproduce la microgranulación, las sombras
internas densas ni la difusión volumétrica completa del grafo de TouchDesigner,
que no se dispone. Requiere revisión visual del usuario; no es una réplica exacta.

## Límites y reversión

- Solo idle: sin interacción con mouse, micrófono, audio ni estados del asistente.
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
