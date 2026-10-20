# WhatsApp como canal de consulta de Gunter

## Alcance

El número puente sigue vinculado por QR, pero ya no exige «Hola Gunter» ni una
ventana de ocho minutos. Cualquier remitente de un chat individual puede
conversar sobre temas generales. La identidad del mensaje se resuelve antes de
leer datos, descargar medios o llamar modelos. Un número vinculado a una cuenta
aprobada consulta solamente esa cuenta; desconocidos nunca heredan el contexto
del administrador. Grupos, broadcasts y mensajes propios no activan el asistente.
Los identificadores LID se resuelven únicamente mediante el alternate JID o el
mapa local de Baileys; un LID sin teléfono acreditado permanece público.

Esta ruta es de consulta: no ejecuta el antiguo planificador de escrituras,
no cancela eventos ni crea tareas o envíos por una respuesta generada. Los
cambios se remiten a la aplicación y sus controles de permisos. Los envíos
manuales desde la aplicación conservan su confirmación existente.

## Datos y permisos

El snapshot v2 del navegador identifica al propietario mediante su ID estable,
no su nombre de usuario. Se construye solo con sesión aprobada/verificada y
dispositivo ligado a la misma cuenta; se verifica de nuevo después de lecturas
asíncronas. El servidor rechaza un propietario diferente. Se omiten registros
explícitamente ajenos o marcados LOCAL, SENSITIVE_LOCAL_ONLY o NEVER_CLOUD.
Los datos legacy sin propietario verificable se omiten, no se reasignan al
usuario conectado. Los proyectos, tareas y documentos nuevos quedan ligados a
su cuenta; consultar datos antiguos sin dueño requiere una revisión/migración
de propiedad explícita fuera de este canal.
El caché global de análisis también exige dueño explícito; no hereda identidad
solo por coincidir el ID de proyecto. Cualquier marca local prevalece sobre una
marca PUBLIC contradictoria, y se omiten credenciales incluso dentro de resúmenes JSON.

El contexto de consultas incluye, cuando existen: tareas, agenda, recordatorios,
proyectos, reuniones/transcripciones acotadas, análisis, documentos/resúmenes,
decisiones y notas de proyecto. Jobs y compromisos se leen del servidor de la
cuenta. Los ajustes se limitan a metadatos de capacidades, nunca credenciales.
La memoria personal local, archivos arbitrarios y notas legacy no verificadas
no se exportan. No significa acceso ilimitado a todo el disco o a otras cuentas.

Las fuentes indican disponibilidad, fecha, truncamiento y estado. Una copia
antigua o una colección no disponible no se presentan como ausencia de datos ni
estado en vivo. Una conversación general no adjunta automáticamente ese contexto
personal. Ejemplos: «¿Qué tareas tengo pendientes?», «¿Qué recordatorios fallaron?»,
«Resume mi proyecto Alfa» o «¿Qué acordamos en la última reunión de Alfa?».

La política del usuario y la del puente restringen el proveedor. LOCAL/LOCAL_ONLY
no caen a cloud cuando falta el modelo. Las listas de proveedores y la opción de
fallback se respetan; una cadena de respaldo no se usa para saltar una lista más
restrictiva. Imágenes requieren permiso de visión cloud; medios de desconocidos
no se descargan/transcriben. El historial público es temporal y no se escribe en
los archivos del dueño; el registro privado depende del ajuste de memoria.
Hay detección de duplicados, ocho consultas por minuto por chat y sesenta
globales. Esto no sustituye los presupuestos/cuotas del proveedor.

## Validación y activación

Pruebas aisladas: `test/whatsapp-assistant-channel.js`,
`test/whatsapp-assistant-context.js` y `test/whatsapp-browser-context.js`.
Usan dobles: no conectan WhatsApp, leen sesiones/credenciales, llaman IA real ni
envían mensajes. El navegador debe sincronizar una copia v2 para consultar sus
datos; las copias v1 se rechazan como contexto privado no acreditado.

El backend debe reiniciarse para cargar la nueva ruta. Esta revisión no reinició
el servidor ni conectó una cuenta real: falta la prueba integral con un número
autorizado y el proveedor permitido. Abrir Gunter permite sincronizar los datos;
sin el navegador abierto se conserva solo la última copia, además de los stores
del servidor. No se certifican mensajes entregados/leídos ni una consulta web
actualizada donde no existe esa fuente.
