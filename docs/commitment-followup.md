# Seguimiento de compromisos

La pestaña Compromisos de Inicio permite revisar registros y crear una tarea
de seguimiento con confirmación explícita. El chat entiende «mis compromisos»
y «convierte el compromiso \"cmt_identificador\" en tarea»; un nombre ambiguo
requiere elegir su identificador. Las órdenes de voz requieren confirmación
escrita o en pantalla para crear la tarea.

Se reutilizan el almacén de compromisos por cuenta del servidor y las tareas
de IndexedDB. La tarea conserva el responsable, plazo, contexto y referencia
de origen. La creación es idempotente por cuenta y compromiso, incluso si la
tarea vinculada ya está completada o cancelada. Los registros globales legacy
no se atribuyen automáticamente a ningún usuario.

Crear o completar una tarea NO marca automáticamente un compromiso cumplido.
El usuario confirma ese estado por separado; cancelar o eliminar un compromiso
no modifica la tarea vinculada. Las confirmaciones caducan y los cambios de
registro o de cuenta invalidan las propuestas anteriores.

Limitaciones: los compromisos requieren el servidor local; las tareas se quedan
en este navegador, sin sincronización añadida. No hay transacción distribuida
entre ambos almacenes: se comprueba el compromiso antes de crear la tarea, pero
son registros independientes. La lista consulta hasta 200 compromisos y avisa
cuando alcanza el límite. La detección automática existente usa cloud autorizado
y se bloquea en LOCAL/LOCAL_ONLY; los compromisos manuales y su seguimiento
siguen disponibles. Un texto sin propietario verificable nunca se analiza
automáticamente desde el panel.

Pruebas focalizadas: `npm run test:commitments`. Tras actualizar, reiniciar el
servidor local y recargar Gunter para obtener las versiones compatibles.
