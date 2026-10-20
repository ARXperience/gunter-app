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

## Biomasa y filamentos acoplados

La energía tiene ahora un estado GPU propio: dos atlas RGBA16F de 48³ celdas,
con advección semilagrangiana RK2, difusión, renovación local y enfriamiento.
No se reproduce ninguno de los videos de referencia. La energía y la materia
leen el mismo campo de velocidad y el atlas energético del paso anterior;
su gradiente curva las fibras cercanas. El calor y la irradiancia del composite
proceden de ese gas, con absorción por materia y profundidad, no del antiguo
emisor tubular analítico. Se conservan colores, densidad real, audio medido,
preferencias, movimiento reducido y el ciclo de vida del compositor existente.
Un atlas reutilizable adicional de velocidad (48³, aproximadamente 0,84 MiB)
evita recalcular curls y gradientes en cada muestra de ambos RK2. No hay una
simulación paralela: los dos sistemas consultan exactamente ese mismo campo.
El borde absorbe por segundo, no por número de pasos, y la masa relaja hacia
una fuente acotada para no desaparecer ni saturar la energía con el tiempo.

El puntero es además un obstáculo local suave para las partículas. Durante
el recorrido se invierte la proyección del paquete central para no interpretar
todo el corredor como si fuera el núcleo. El contenedor no sigue al mouse.
Las formas asignan cada corriente a un trazo autorado estable, muestreado por
longitud de arco: no se conectan arbitrariamente dedos, tentáculos o contornos
independientes. Las guías se generan bajo demanda y sus texturas se reutilizan.

`/js/dev/core-bio-lab.html` permite revisar energía, materia, filamentos y
composición por separado, sobre fondo oscuro, claro o ajedrezado. Utiliza
`GunterIdleCore`, no otro renderizador. No lee/escribe preferencias, llama APIs,
solicita micrófono ni introduce controles en el dashboard. Su captura de canvas
usa 19 segundos de tiempo real para dejar margen al codificador; la duración
útil del archivo se comprueba después, sin rellenarlo ni simular fotogramas.

Las capas del ZIP son referencias cromáticas aproximadas, no datos volumétricos
ni un campo de velocidades de TouchDesigner. Esta reconstrucción sigue siendo
una aproximación procedural de resolución acotada, no una recuperación exacta
de la simulación original. Punto de reversión previo: `0e1db872d4f813725d490d7b186dce6da3b9f99a`.

Validación focalizada en Chrome local: cuatro fotogramas originales (5, 20,
35 y 50 s), cuatro poses de cada revisión y segmentos continuos de energía
(18,79 s) y composición (18,94 s), sin interpolación de movimiento. Se
comprobaron las cuatro capas, fondo ajedrezado con alfa de esquina cero,
Inicio ↔ Tareas, mano/medusa por el chat existente y vista de 390 × 844 sin
desbordamiento horizontal. Las preferencias originales permanecieron intactas.
Los contratos Node cubren guías/trayectorias, preferencias, recursos/feedback,
restauración, advección, absorción temporal y captura/limpieza del laboratorio.
`npm run test:bio-core` reúne únicamente esas pruebas.

No se cierra la fidelidad de fase 2: la materia sigue más suave y menos
microgranulada que la referencia; algunas siluetas conservan contornos oscuros
con iluminación débil. La captura de composición pasó de aproximadamente 6
a 12,5 fotogramas guardados/s tras reutilizar el campo, pero incluye el coste
del codificador y no certifica 30 FPS ni fluidez equivalente al original.
La compilación inicial de shaders también puede demorar en este equipo.
No se validaron visualmente las 79 siluetas ni hardware móvil físico; el tamaño
móvil se comprobó mediante viewport de Chrome. No se alteraron permisos,
modelos, rutas de voz ni se repitieron sus pruebas.

## Material interior de las transformaciones — 19 de octubre de 2026

Las formas ya no se apoyan únicamente en la distancia a sus contornos. El
catálogo distingue regiones de materia autoradas y huecos explícitos: palma,
alas, campana de medusa, hoja de espada y cuerpos de las familias animales y
cósmicas. No se rellena indiscriminadamente todo trazo cerrado; pupilas,
portales y anillos conservan espacio negativo. Se añaden pliegues de palma,
radios del iris, nervaduras y facetas a las mismas trayectorias existentes.

La guía RGBA conserva en RG el trazo más cercano, en B la distancia firmada
a la materia y en A el ancho del trazo. W de las trayectorias transporta el
alcance interior firmado sobre la normal izquierda, limitado por la primera
salida del cuerpo o entrada en un hueco. La condición de cierre permanece en
los metadatos de cada fila. Así se distribuyen fibras por el interior sin unir
dedos, alas o tentáculos a través del aire. Los detalles anatómicos conservan
su trayectoria en lugar de redistribuirse como si fueran bordes exteriores.

El volumen gana espesor y pliegues internos, reutilizando los campos de pliegues,
cavidades y grano del material orgánico ya calculados. El soporte del gas conserva las
celdas que ya están dentro del cuerpo; no las evacua hacia el borde. Su fuente
de renovación usa canales coherentes independientes de los pliegues más opacos
de la materia. La porosidad óptica y el contraste granular se interpolan solo
durante la transformación; con peso cero la respuesta orgánica anterior se
conserva. La cobertura de salida de las fibras transformadas se refuerza sobre
fondos claros sin multiplicar el RGB emitido ni cambiar la extinción del gas.
Gas y fibras siguen compartiendo el campo de velocidades y la energía
transportada, sin nuevas texturas de simulación, emisores puntuales, imágenes
superpuestas ni incremento del número de partículas predeterminado.

Las formas no guardan paletas o densidades propias. Las cuatro capas cromáticas,
densidad, brillo, velocidad y tamaño siguen llegando desde `GunterParticles`.
Editar preferencias durante una forma activa no cancela su duración, no recrea
el compositor ni guarda esa forma como preferencia fija. El laboratorio añade
solo controles efímeros para comprobarlo; no introduce un selector de formas
en Inicio ni lee/escribe las preferencias reales.

Pruebas focalizadas: catálogo/regiones/trayectorias, laboratorio, preferencias
en una forma activa y contratos GPU de advección, energía enterrada, porosidad,
restauración y recursos. Los dobles WebGL no certifican por sí solos fidelidad
visual. En Chrome local se compararon mano, ojo, medusa y mariposa sobre fondo
claro, energía aislada y composición. La misma mano respondió al cambio de los
cuatro HEX sin cambiar de forma; la prueba no modificó preferencias guardadas.
La última revisión de cobertura se comprobó en mano y mariposa, sin errores de
consola observados y conservando alfa cero en la esquina. No se repitió el
benchmark ni se certifica una nueva tasa de fotogramas.

Las referencias siguen siendo ilustraciones de mucho mayor detalle
que esta reconstrucción procedural acotada; no se declara equivalencia exacta
ni validación individual de las 79 formas. Punto de reversión previo:
`2a518ee2e43c01fba7f5fda88de24d55a5bcb8d2`.

## Biomembranas compactas — revisión posterior

El material orgánico usa bandas estrechas, cavidades y una piel irregular en
lugar de lóbulos de niebla rellenos. El volumen resuelve películas finas a
resolución del rayo, conservando los 48³/40 pasos y los dos estados de gas.
Se añade una superficie procedural plegada y perforada, de 96 × 64 celdas
(36 864 vértices), generada con `gl_VertexID`: no usa imágenes, vídeos,
texturas de referencia ni buffers de geometría adicionales. Es una superficie
material, no una segunda simulación energética: lee el mismo campo de velocidad
y calor que las partículas. Sus normales de superficie aportan reflejos y
translucidez; el gas sigue determinando la iluminación interior.

La superficie reutiliza los cuatro colores, brillo, tamaño, densidad, transporte
y fase existentes. Se desvanece con el morph hacia una forma nombrada. Materia
sola permite aislarla; energía y filamentos solos no la dibujan. La pasada
adicional no aumenta los atlas/FBO, pero sí añade un programa y un draw: no se
afirma coste cero ni una nueva tasa de FPS. No es una simulación elastodinámica
de tejido ni una reconstrucción exacta de la fotografía de referencia.

Las pruebas GPU cubren recursos, restauración, colores, transporte, formas y
vistas aisladas; el laboratorio permite comparación visual en Chrome. Punto de
reversión previo a esta revisión y al cambio de WhatsApp: `72e5d46`.

Validación nativa de esta fase: composición orgánica con paleta cálida temporal,
después mano para comprobar que la piel exterior se desvanece. Sin errores de
consola observados, alfa cero en la esquina, sin cambiar preferencias guardadas.
La captura `output/bio-membranes-final.png` documenta el resultado, todavía con
menos microdetalle que la referencia; no es una certificación de equivalencia
visual ni de rendimiento. Pasan 49 contratos GPU y 21 de presencia/transporte.
