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
el viaje. Dos enrollamientos locales 3D, un rezago acotado y contracorrientes
curl sustituyen el estiramiento longitudinal uniforme. Materia y filamentos
comparten el mapa volumétrico; se conserva la historia advectada, la resolución
y las pasadas GPU. Una inversión conserva la intensidad del remolino anterior.
Es una aproximación visual de humo, no un solver CFD completo ni una réplica de
TouchDesigner. El recorrido acelera y frena suavemente; su fase respeta la velocidad configurada
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

No hay selector permanente de formas. Tres clics/toques sobre el centro de
Gunter en Inicio, dentro de 1,2 segundos, eligen una silueta aleatoria entre
estrella invertida, ojo, mano, espada y ocho puntas, sin repetir la anterior.
El mismo botón transparente acepta tres activaciones de teclado. Los clics
aislados y la navegación no activan formas. La interacción no accede a voz,
permisos ni almacenamiento y no se interrumpe con nuevos triples clics.

`GunterParticles.playShape(host)` guía las fibras existentes hacia esa forma,
sin reiniciar su historia. A los 5,2 segundos inicia el retorno orgánico;
salir de Inicio, ocultar la página o abandonarla cancela el efecto. Con movimiento
reducido o velocidad cero se muestra una silueta temporal estática, sin nueva
RAF. Los valores legacy de `coreVisual.shape` no se borran ni se usan como forma
fija; editar colores tampoco los sobrescribe. No hay generación de figuras por
texto libre ni imágenes superpuestas.

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

Comprobación visual de esta iteración en Chrome: triple clic en Inicio, formas
temporales (mano en escritorio, ojo en viewport 390 × 844), vuelta automática
al orgánico y varios momentos de ida y vuelta Inicio ↔ Tareas. La zona de clic
es transparente incluso con hover; el mapa y el chat conservan sus controles.
No hay desbordamiento horizontal ni errores de compilación WebGL observados.
Las pruebas GPU usan dobles de WebGL para contratos y recursos, no certifican
fidelidad visual ni rendimiento. Las formas son siluetas básicas, no réplicas
de las ilustraciones. La versión anterior queda recuperable en Git (`07375d9`),
sin copias paralelas.
