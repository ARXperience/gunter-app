# Estado y reintento conversacional de avisos

Reutiliza `GunterJobs`, `/api/jobs`, el scheduler y los archivos por cuenta existentes. No añade modelos, almacenamiento ni servicios cloud.

## Uso

- `Mis recordatorios fallidos` muestra los avisos fallidos registrados (máximo 12).
- `Por qué falló el recordatorio "Tomar vitaminas"` consulta el estado y una explicación basada en datos disponibles.
- `Estado del recordatorio "Tomar vitaminas"` también explica avisos programados, en ejecución, en reintento automático, procesados o cancelados.
- `Reintenta el recordatorio "Tomar vitaminas"` propone reintentar ahora. No escribe hasta recibir confirmación por texto o en pantalla.
- Después de una lista o consulta, `por qué falló el primero`, `reintenta el primero` y `reinténtalo` reutilizan las referencias de conversación, si su continuidad está habilitada. Nombres ambiguos requieren selección; nunca se escoge otro aviso por aproximación.

## Límites y garantías

- Solo se reintentan recordatorios independientes durables en estado `failed`. No seguimientos, avisos vinculados a reuniones, cancelados, completados, en ejecución ni con reintento automático pendiente.
- Una orden y un aviso cada vez. No se reintentan todos ni se aplica una parte de una orden compuesta.
- `retry_reminder` exige sesión propietaria, confirmación explícita y snapshot/revisión actual. Conserva ID, payload, prioridad, fecha de creación y máximo de intentos.
- El cambio es atómico. Un fallo al persistir conserva el archivo anterior. Se bloquea un aviso activo equivalente, incluso si conserva el dedupe anterior.
- Se reinicia el estado de ejecución y se conserva únicamente el último fallo en `lastFailure`. Estos datos quedan en el mismo archivo privado de la cuenta, no en otro historial.
- Consultas y resultados conversacionales no exponen payload, errores brutos, `lastFailure` ni respuestas de proveedores push. Las causas desconocidas se declaran desconocidas; no se inventan diagnósticos.
- `completed` no demuestra entrega o lectura en el teléfono. Una intervención persistida significa bandeja guardada; push aceptado tampoco significa lectura.
- El reintento queda programado para ahora, sujeto al siguiente ciclo del scheduler y a que el servidor local siga funcionando. No promete entrega ni plazo. Si algún canal ya mostró el aviso antes de fallar otro paso, puede aparecer nuevamente; la confirmación lo advierte.
- Si el scheduler procesa el aviso antes de la reconsulta, no se afirma un estado no verificado: consultar su estado antes de repetir, nunca reintentar automáticamente desde el chat.
- No se activan permisos de notificaciones, servicios cloud ni canales nuevos. Se conserva LOCAL_ONLY y Permission Gate.
- Se conserva `retry(id)` legacy para sus consumidores existentes; el flujo conversacional usa exclusivamente el contrato confirmado.

## Comprobación focalizada

`npm run test:reminder-retry` ejecuta los tests nuevos de backend, cliente, conversación y política. No requiere audio, modelos ni red.

Tras actualizar: reiniciar el servidor local para cargar la operación nueva y recargar la página. Las URLs de scripts fueron versionadas para evitar el cliente anterior en caché. No hay merge ni despliegue automático.
