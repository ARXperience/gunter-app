# Núcleo: voz real y continuidad visual

El analizador existente de `GunterVoice` mide RMS de la salida realmente
reproducida. El contexto de audio se prepara también al iniciar una respuesta
automática, sin necesitar otro clic cuando el navegador ya permite audio.
Si no existe señal utilizable, no se inventa amplitud ni se bloquea la voz.
El shader modula la emisión interna y los filamentos cercanos; no aplica
destellos globales ni una pulsación basada en el indicador «hablando».

`GunterCorePresence` conserva el host y canvas originales de Inicio y un ancla
para su mapa. Fuera de Inicio, la materia flota sobre el acceso transparente
al chat inferior izquierdo: no hay disco ni borde circular. El octagrama de
ocho puntas comparte la identidad del resto de iconos, con colores existentes.
El chat, su historial, controles y Permission Gate no se reemplazan.

El canvas se amplía una vez al corredor entre destinos y permanece fijo durante
el viaje. Un mapeo GPU curva, expande y dispersa las mismas fibras y su volumen
luminoso: no son copias de una imagen ni un bloque trasladado por CSS. La
advección/curl y el tiempo del compositor continúan; la fase del viaje también
respeta la velocidad configurada (1800 ms / velocidad, sin contar pausas).
Se trata de transporte visual del medio, no un nuevo solver hidrodinámico.

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

Pruebas focalizadas: `core-presence-transition`, `core-renderer`,
`idle-core-gpu`, `octa-icons`, identidad y navegación conversacional. No se
repiten benchmarks de voz ni se cambian sus modelos o permisos.

Comprobación visual en Chrome: expansión y recomposición del río en Inicio ↔
Tareas, octagrama, acceso transparente al chat, Configuración y viewport móvil.
WebGL compiló sin errores; el botón del chat conserva apertura y cierre. La
versión anterior queda recuperable en Git (`1b7f678`), sin copias paralelas.
