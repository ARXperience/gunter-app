# Captura conversacional de recordatorios

«Activa una alarma para hacer ejercicio a las 11 de la mañana» y «quiero un
recordatorio para mañana para hacer ejercicio» usan `reminder.schedule` y
`GunterJobs`, no el activador de preferencias ni un módulo nuevo de alarmas.
«Alarma» aquí significa aviso de Gunter; no configura el reloj del dispositivo.

La extracción conserva el asunto aunque la fecha aparezca antes. El parser
local separa mañana-fecha de «de la mañana». Una fecha sin hora pregunta la
hora; nunca programa por el valor 09:00 del resultado `allDay`. Si el horario
ya pasó, pregunta día/hora sin desplazarlo automáticamente al día siguiente.

Los datos incompletos utilizan el pendiente existente (`stage: collecting`),
con propietario, caducidad de cinco minutos y continuidad configurable. No son
trabajos programados. La respuesta siguiente conserva fecha, asunto y origen
de voz; confirmar por voz no autoriza la creación. Cambiar de cuenta invalida
el borrador y una operación en curso nunca se atribuye a la nueva cuenta.

El resultado se confirma consultando el trabajo guardado. La entrega requiere
servidor activo y un canal disponible; sonido y notificaciones dependen de los
permisos/dispositivo. No se creó ningún aviso real en las pruebas.

Validación: `node test/reminder-create-language.js`,
`node test/conversational-followups.js` y `node test/reminder-edit-tools.js`.
