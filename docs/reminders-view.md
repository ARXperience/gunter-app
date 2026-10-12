# Vista unificada de Recordatorios

En Inicio → Recordatorios se consultan los avisos de la cuenta activa: locales en IndexedDB y persistentes en el servidor existente. `GunterNotificationsService.listSnapshot` es la fuente compartida con las consultas del chat; no hay nuevo almacenamiento ni sincronización cloud.

## Operación

- Filtros: Activos, Fallidos, Historial y Todos. Los estados desconocidos son visibles en Todos, sin acciones de escritura.
- Cada fila muestra fecha/hora completas en la zona horaria configurada, estado y dependencia: navegador abierto, servidor local encendido o reunión vinculada.
- Detalle usa el diagnóstico existente para avisos persistentes. No muestra errores brutos, payloads, historial de fallos ni secretos.
- Reintentar solo se ofrece para recordatorios persistentes independientes fallidos. Cancelar solo para independientes pendientes, no para entregas en ejecución.
- Ambas escrituras reutilizan las herramientas y Permission Gate. Requieren confirmación explícita en pantalla; una confirmación sustituida por otra en el chat no se acepta. No se activan permisos de notificaciones al consultar la vista.
- Los vinculados se gestionan desde Agenda. La vista no cambia ni cancela una reunión indirectamente.
- Cambiar de cuenta descarta datos y confirmaciones de la vista, incluidas respuestas tardías al volver a la misma cuenta. Cerrar el detalle descarta solo su propia propuesta, no otra pendiente del chat.
- Actualizar vuelve a consultar ambas fuentes. Cuando el panel está visible, se actualiza cada 30 segundos, sin interrumpir el foco de sus botones. También se actualiza tras eventos de cambios, vuelta a la pestaña y cambios de autenticación.
- Se muestran 25 filas por tanda; Mostrar más amplía los registros ya consultados.

## Integridad y límites

Las cancelaciones locales usan el snapshot de título/fecha/estado/actualización dentro de la misma transacción que escribe. Las persistentes exigen sesión propietaria, confirmación y snapshot/revisión exactos en el servidor. Se conserva el registro y su historial; no se elimina ni se sobrescribe un aviso cambiado o en ejecución. Las llamadas antiguas permanecen compatibles.

Las fuentes caídas se indican como consulta incompleta, nunca como ausencia confirmada de avisos. La colección persistente tiene un máximo de 200 registros por estado consultado; al alcanzar ese límite se advierte expresamente. Activos y Fallidos consultan sus estados para que el historial no oculte avisos pendientes; Todos conserva el límite global y no equivale a un archivo histórico ilimitado.

El scheduler filtra sus estados pendientes antes de aplicar el límite de lectura: más de 200 avisos históricos ya no impiden procesar uno nuevo. Las copias locales con identidad `job_` no sustituyen la fuente del servidor, ni se reasignan registros legacy sin propietario.

Procesado/disparado no implica que el usuario recibió, oyó o leyó el aviso. El reintento puede volver a mostrar un aviso parcialmente entregado; la confirmación existente lo advierte. La pantalla no promete entrega al teléfono ni ejecución con el PC apagado.

## Comprobación y actualización

`npm run test:reminders-view` reúne las pruebas nuevas focalizadas de agregación, cancelación local/durable, Permission Gate y vista. Sin modelos, micrófono, red ni benchmarks.

Reiniciar el servidor local tras actualizar y recargar la página. Se versionaron los recursos compartidos en las siete páginas; no hay merge ni despliegue automático.
