# Núcleo generado — primera fase idle

El núcleo de Inicio, Configuración y las miniaturas se dibuja con WebGL 1, sin
Three.js ni dependencias nuevas. El video se usó exclusivamente como referencia:
los archivos de la fase anterior se conservan, pero no se cargan ni reproducen.

Los filamentos y las partículas se deforman en el vertex shader mediante un campo
de ruido vectorial y su curl analítico. Las capas plegadas, el polvo luminoso
interno y el bloom de dos pasos comparten un compositor GPU. La salida RGBA es
premultiplicada e incluye la transparencia del halo, sin discos ni fondos negros.

### Refinamiento del flujo

Los filamentos cortos se agrupan en plumas con una capa difusa intercalada, sin
aumentar el número de vértices ni añadir pasos de render. Dos escalas de curl
producen corrientes opuestas: el material interior circula más rápido que la
envolvente, mientras la orientación global cambia poco. La emisión sigue bolsas
de calor espaciales con ritmos distintos y textura plegada; el bloom selecciona
esa luz cromática, evitando teñir o sobreexponer todos los filamentos grises.

La velocidad se integra en la fase del montado compartido: cambiarla, pausarla
o reanudar no reinicia la forma ni produce un salto temporal. No se cambian los
seis controles ni las preferencias guardadas.

## Uso existente

Cargar `js/components/gunter-idle-core.js`, `js/services/gunter-particles.js` y
`styles/gunter-idle-core.css`. Añadir un contenedor posicionado, con ancho y alto,
y `data-gunter-particles="hero"` (o `chat`/`thumb`). El montado es automático;
también se puede llamar `GunterParticles.mount(elemento)`.

`GunterParticles.configure({ color, glowColor, brightness, density, speed, size },
{ persist: true })` actualiza las vistas y guarda solo estos ajustes dentro del
`gunter_prefs.coreVisual` existente, conservando las preferencias heredadas.
Los seis controles están en Configuración → Apariencia → Núcleo generado.

Para integrar el componente sin el sistema de montado:

```js
const core = new GunterIdleCore();
core.renderTo(canvas, 512, 512, segundos, {
  color: '#ff452b', glowColor: '#ff6d35', brightness: 1,
  density: 1, speed: 1, size: 1
});
// El consumidor decide cuándo dibujar otro frame y cuándo liberar recursos.
core.dispose();
```

## Límites deliberados

- Solo reposo: no escucha eventos de mouse, voz, micrófono ni estados del asistente.
- Se conservan intactos los servicios de conversación, permisos, STT y TTS.
- Máximo dos vistas grandes animadas, 30 fps como techo y resolución máxima 720 px;
  las miniaturas usan un frame generado, no otro contexto WebGL.
- «Reducir animaciones», velocidad cero, pestaña oculta y vistas fuera de pantalla
  detienen la animación. Los recursos se liberan al salir.
- Sin WebGL se anuncia la indisponibilidad visual; no se sustituye con video ni
  se solicita acceso a dispositivos o servicios externos.
- Es una aproximación procedural al humo de la referencia, no una reproducción
  idéntica de su simulación original. Pendiente aprobación visual del usuario y
  comprobación en teléfonos físicos; no se añade aún interacción.

Pruebas focalizadas: `test/core-renderer.js`, `test/idle-core-gpu.js` y
`test/core-visual-settings.js`. La comprobación real en navegador cubre shaders,
movimiento, canal alfa, contraste de fondos, Inicio y controles persistentes.
