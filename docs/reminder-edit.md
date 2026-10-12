# Edición conversacional de recordatorios independientes

Reutiliza `GunterAssistantTools`, `GunterJobs`, la cola durable por cuenta (`jobs.json`) y el Permission Gate existente. No crea almacenamiento, modelo, sincronización ni permisos nuevos.

## Uso

- `Reprograma el recordatorio "Tomar vitaminas" para mañana a las 10`.
- `Renombra el recordatorio "Tomar vitaminas" a "Vitaminas después del desayuno"`.
- `Mis recordatorios` → lista numerada; `mueve el primero para mañana a las 10`.
- Después de seleccionar o editar: `muévelo para mañana a las 10`, `renómbralo a "Nuevo nombre"`.
- Para corregir una propuesta: `mejor a las 11`, conservando el día que se estaba proponiendo.

Una modificación por orden: nombre o fecha/hora. El nombre o identificador se resuelve exactamente, no por parecido. Nombres duplicados piden elegir un número. La propuesta muestra el valor anterior y el nuevo; requiere confirmación por escrito o en pantalla, no basta una respuesta hablada. Rechazarla no escribe nada. Desactivar continuidad deshabilita referencias implícitas, pero no órdenes con el nombre exacto.

## Integridad y privacidad

El cambio conserva ID, creación, contenido adicional y prioridad. Reprogramar actualiza el aviso existente, no crea otro. Recalcula la deduplicación derivada y conserva claves personalizadas; ante otro aviso equivalente rechaza el cambio sin sustituir registros.

La cuenta está verificada antes y después de cada petición. El servidor compara `ownerId` con la sesión real, sin usar el nombre o correo como propietario. Las pestañas con una cuenta obsoleta no leen ni confirman avisos de la nueva cuenta. El historial de avisos vistos se guarda por cuenta, sin migrar ni atribuir el registro global legacy.

Cada transición de la cola incrementa una revisión. El servidor valida el snapshot confirmado y escribe todo junto; si otro proceso cambió el aviso, pide una nueva propuesta. Un fallo de reemplazo del archivo conserva el anterior: no usa una copia no atómica como alternativa. El scheduler reconsulta cada aviso antes de ejecutarlo, incluso después de esperar otro trabajo, para no disparar una versión anterior a la reprogramación.

`reminder.update` utiliza `automation.basic` / `jobs.write`, autonomía máxima L3 y evidencia de reconsulta con ID y revisión persistidos. No amplía permisos ni evita las restricciones del centro de control.

## Límites

Al pasar del historial global de avisos vistos al historial por cuenta, el primer ingreso puede volver a mostrar avisos completados propios. No se migra la lista global porque no permite verificar su propietario.

Solo recordatorios independientes programados, sin intentos de entrega previos. No edita avisos en ejecución, espera de reintento, fallidos, completados o cancelados; tampoco seguimientos ni avisos locales vinculados a reuniones. Para estos últimos se modifica la reunión, conservando la antelación del aviso.

Fecha futura con hora exacta, hasta 366 días; sin recurrencias ni fechas de todo el día. Las fechas inexistentes se rechazan en el intérprete compartido sin pedir al LLM que las convierta en otra fecha. No admite ediciones compuestas o cambios de prioridad/contenido en esta fase.

La cola requiere que el servidor local siga funcionando. La entrega en el dispositivo depende de sus canales y permisos existentes; no se concede permiso de notificación automáticamente.

## Pruebas

`npm run test:reminder-edit`: API/cola con datos aislados, snapshots, revisión, rollback, deduplicación, carrera del scheduler, cliente por cuenta, conversación, voz/confirmación, fechas inválidas y política/evidencia. No requiere navegador automatizado, modelos ni benchmarks.
