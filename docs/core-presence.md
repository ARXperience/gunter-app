# Núcleo: voz real y continuidad visual

El analizador existente de `GunterVoice` mide RMS de la salida realmente
reproducida. El contexto de audio se prepara también al iniciar una respuesta
automática, sin necesitar otro clic cuando el navegador ya permite audio.
Si no existe señal utilizable, no se inventa amplitud ni se bloquea la voz.
El shader modula la emisión interna y los filamentos cercanos; no aplica
destellos globales ni una pulsación basada en el indicador «hablando».

`GunterCorePresence` conserva el host y canvas originales de Inicio y un ancla
para su mapa. Fuera de Inicio, la materia flota sobre el acceso transparente
al chat inferior izquierdo: no hay disco ni borde circular. La geometría ya no
es una máscara CSS superpuesta: es una silueta de la propia materia GPU.
El chat, su historial, controles y Permission Gate no se reemplazan.

El canvas se amplía una vez al corredor entre destinos y permanece fijo durante
el viaje. La deformación 3D, el rezago y el campo curl se integran en el historial
material GPU; se eliminó la deformación reversible después de proyectar a
pantalla. El volumen aproxima la densidad en una métrica 3D equivalente; no es
un solver CFD completo. La fase del recorrido respeta la velocidad configurada
(2400 ms / velocidad, sin contar pausas), sin acelerar el reloj de advección.

Los enlaces internos entre documentos esperan el recorrido de salida. El
regreso a Inicio usa solo un token visual en sessionStorage con caducidad de
5 segundos, sin datos personales. El navegador crea otro documento y canvas:
no se promete continuidad física de la simulación entre páginas HTML. Dentro
de una página sí se conserva el compositor y su historial. Enlaces externos,
descargas, nuevas pestañas y rutas sensibles conservan su comportamiento.
Movimiento reducido, velocidad cero o WebGL no disponible omiten el recorrido
sin bloquear la navegación; las interrupciones cancelan la RAF anterior.

La resolución de render se mide con dimensiones de layout, no con el tamaño
temporalmente escalado: volver de la esquina a Inicio no deja un canvas borroso.
WebGL, pestañas ocultas, BFCache y la ocultación del chat conservan su ciclo
de vida. No hay nuevos modelos, bibliotecas, micrófonos ni permisos.

## Formas y personalización

`coreVisual.shape` acepta `organic`, `pentagram` (una punta abajo), `eye`,
`hand`, `sword` y `octagram`. Son soportes y atractores procedurales que guían
las fibras existentes, no imágenes ni líneas estáticas superpuestas. El morph
retiene el historial; con movimiento reducido o velocidad cero se presenta el
destino estático. No se promete transformar texto libre en cualquier figura.

El estudio orbital reutiliza `GunterParticles.configure` y `gunter_prefs`:
partículas, materia/sombras (`shadowColor`), energía y emisión son independientes.
El selector HSV y HEX actúa sobre la capa seleccionada y conserva los rangos
anteriores de densidad, brillo, velocidad y tamaño. Las opciones guardadas se
mantienen; `themeAdaptive` usa una paleta derivada para cada modo sin sobrescribir
los HEX. Desactivarlo utiliza los colores seleccionados exactos en ambos temas.

`theme-bootstrap` resuelve el modo antes del CSS y del primer paint; el toggle
reutiliza esa fuente. Se respetan modo explícito, valores legacy y preferencia
del sistema, sin confundirlos con los perfiles de reunión. El evento
`gunter-theme-changed` actualiza el núcleo sin reconstruir su compositor.

Pruebas focalizadas: `core-presence-transition`, `core-renderer`,
`idle-core-gpu`, `core-visual-settings`, `theme-first-paint` y contratos de UI. No se
repiten benchmarks de voz ni se cambian sus modelos o permisos.

Comprobación visual en Chrome: expansión y recomposición del río en Inicio ↔
Tareas, seis siluetas, colores de materia, Configuración y viewport móvil de
390 × 844 sin desbordamiento horizontal. Se revisó navegación entre documentos
en modo claro y retorno a oscuro; los shaders WebGL compilaron sin errores.
Las pruebas GPU usan dobles de WebGL para contratos y recursos, no certifican
fidelidad visual ni rendimiento. Las formas son siluetas básicas, no réplicas
de las ilustraciones. La versión anterior queda recuperable en Git (`c9f460f`),
sin copias paralelas.
