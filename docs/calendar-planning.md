# Jornada y márgenes por cuenta

Extiende `GunterEventsService`, `GunterAssistantTools` y Configuración → Asistente e IA. Usa `gunter_prefs.calendarPlanningByAccount[user.id]`: no crea base de datos ni sincronización, no reasigna preferencias legacy ni usa nombre/email como propietario.

## Ajustes y uso

La jornada empieza desactivada y el margen en cero, conservando el comportamiento anterior. Los valores de edición iniciales son lunes–viernes, 09:00–18:00. Leer, entrar, recargar o cambiar de cuenta nunca los guarda automáticamente.

El formulario permite activar la jornada, elegir días, inicio/fin y margen entero de 0–120 minutos. Guardar es explícito. No admite una jornada que cruce medianoche. Recargar y descartar borrador vuelve a los valores guardados sin escribir.

Órdenes de ejemplo:

- `Activa mi horario laboral` / `Desactiva el horario de trabajo`.
- `Cambia mi jornada de 09:00 a 17:30`.
- `Configura mis días laborales a lunes, miércoles y viernes`.
- `Configura mis días laborales de lunes a viernes`.
- `Deja 15 minutos entre reuniones` / `Quita el margen entre reuniones`.
- `Mis preferencias de agenda` / `Qué horario laboral tengo`.

Reutiliza `preferences.update` y `settings.list`, sin servidor ni modelo. Los cambios conversacionales siempre piden confirmación; una respuesta hablada no los autoriza. Solicitudes ambiguas o compuestas piden precisión en lugar de aplicar solo una parte. Cambiar horas/días no activa por sí solo la jornada; desactivarla conserva sus valores y el margen independiente.

## Planificación segura

La comprobación de agenda usa los ajustes reales de la cuenta, no una política enviada por un archivo, modelo o argumento de consulta. Distingue cruces reales, incumplimientos del margen y horarios fuera de la jornada. Puedes confirmar expresamente una excepción sin modificar otros eventos ni cambiar tu configuración.

Las alternativas mantienen duración y el día local, respetan días/jornada cuando está activada y dejan el margen configurado a ambos lados de eventos existentes, sin duplicarlo. La zona horaria es la misma de Gunter; las ventanas se calculan con fechas locales, incluidos minutos omitidos/repetidos por horario de verano. Sin huecos en ese día, no inventa alternativas de otro día.

La huella de aprobación incorpora los ajustes; un cambio posterior invalida el guard al guardar el evento. Los formularios y propuestas guardan un baseline de política: si cambió en otra pestaña, no sobrescriben esa decisión. Los borradores se conservan por sesión de edición de la cuenta mostrada y se descartan al cambiar de cuenta; lecturas/guardados tardíos no vuelven a mostrar datos de la anterior.

Los registros incompletos, recurrentes o de día completo conservan sus advertencias de cobertura. No se promete disponibilidad universal. Sin sincronización automática, pausas de almuerzo, turnos nocturnos o cálculo de traslados en esta fase.

## Comprobación

`npm run test:calendar-planning`: interfaz por VM, conversación, preferencias reales del servicio, aislamiento, validación, persistencia, borradores obsoletos, zona horaria/DST, márgenes y guardas concurrentes. `node test/calendar-schedule-tools.js` y las suites directamente afectadas comprueban compatibilidad. Sin navegador automatizado, modelos ni benchmarks.
