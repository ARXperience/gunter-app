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
curl sustituyen el estiramiento longitudinal uniforme. Las capas de materia
viajan con fases, giros y órbitas diferentes: no comparten un centro rígido.
El ray march invierte ese mapa por profundidad para que energía y fibras
viajen juntas. Se conserva la historia advectada, la resolución
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
Los documentos compatibles usan View Transitions nativas de 280 ms, con
entrada óptica breve y sin nuevos paquetes. En los demás, los enlaces siguen
funcionando normalmente. Los paneles del mismo documento tienen una entrada
equivalente; ambas se omiten con movimiento reducido.

La resolución de render se mide con dimensiones de layout, no con el tamaño
temporalmente escalado: volver de la esquina a Inicio no deja un canvas borroso.
WebGL, pestañas ocultas, BFCache y la ocultación del chat conservan su ciclo
de vida. No hay nuevos modelos, bibliotecas, micrófonos ni permisos.

## Formas y personalización

No hay selector permanente de formas. Tres clics/toques sobre el centro de
Gunter en Inicio, dentro de 1,2 segundos, eligen una de las 79 siluetas básicas
del catálogo compartido, sin repetir la anterior: geometría, ojos, animales,
flora, símbolos egipcios/mesopotámicos y artefactos de las referencias.
El mismo botón transparente acepta tres activaciones de teclado. Los clics
aislados y la navegación no activan formas. La interacción no accede a voz,
permisos ni almacenamiento y no se interrumpe con nuevos triples clics.

`GunterParticles.playShape(host)` guía las fibras existentes hacia esa forma,
sin reiniciar su historia. Mantiene la silueta cinco segundos después del
morph de entrada (1,65 s / velocidad) y retorna al orgánico. Salir de Inicio
cancela el juego aleatorio; ocultar o abandonar el documento cancela todas
las formas temporales. Con movimiento
reducido o velocidad cero se muestra una silueta temporal estática, sin nueva
RAF. Los valores legacy de `coreVisual.shape` no se borran ni se usan como forma
fija; editar colores tampoco los sobrescribe. No hay imágenes superpuestas.

`app.core.shape` conecta el catálogo con las rutas existentes de chat y voz:
«conviértete en medusa durante veinte segundos», «adopta la forma de ojo de
Horus», «mantén esta forma por un minuto», «vuelve a tu núcleo orgánico» y
«lista tus formas». Admite entre cinco segundos y una hora, con duración
predeterminada de cinco segundos. La orden puede interrumpir otra forma sin
reiniciar partículas; las guías GPU se cargan bajo demanda, no las 80 a la vez.
Una forma desconocida o un renderer indisponible no se anuncia como ejecutado.
Es una acción visual efímera, no una autorización para modificar datos: las
demás acciones por voz conservan sus confirmaciones. No genera siluetas
arbitrarias fuera del catálogo ni conserva una previsualización entre documentos.

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
Inicio y los interiores comparten el mismo gradiente de fondo; el color del
primer paint coincide con su borde. El acceso a Memoria ya no está en Inicio.
Modo sabio aparece únicamente si `tutorMode` está activo y la cuenta tiene
acceso, incluyendo cambios recibidos desde otra pestaña. El logo pequeño usa
una versión SVG óptica de ocho puntas, sin detalle subpíxel ni desenfoque.

Pruebas focalizadas: `core-form-catalog`, `core-form-commands`,
`core-presence-transition`, `core-renderer`, `idle-core-gpu`, `orbit-home`,
`theme-first-paint`, `interior-theme` y rutas de conversación afectadas. No se
repiten benchmarks de voz ni se cambian sus modelos o permisos.

Comprobación visual en Chrome: triple clic en Inicio, medusa y dragón en
escritorio, ojo de Horus en 390 × 844, estrella invertida, vuelta automática
al orgánico y varios fotogramas de ida y vuelta Inicio ↔ Tareas en ambos tamaños,
comparados con el strip extraído del MP4 de humo. La zona de clic
es transparente incluso con hover; el mapa y el chat conservan sus controles.
No hay desbordamiento horizontal ni errores de compilación WebGL observados.
Se comprobó también la desaparición/reaparición de Sabio desde su switch real,
restaurando su valor inicial, el logo de 30 px y el fondo común en móvil.
Las pruebas GPU usan dobles de WebGL para contratos y recursos, no certifican
fidelidad visual ni rendimiento. Las formas son siluetas básicas, no réplicas
de las ilustraciones. Una inversión de ruta antes de terminar el viaje aún
reancora el conjunto desde su centro actual, no desde cada paquete individual.
La versión anterior queda recuperable en Git (`293f9e9`),
sin copias paralelas.
