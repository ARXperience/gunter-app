# Configuración por conversación

`GunterAssistantTools` reutiliza `PremiumFeaturesService.DEFAULTS`, `ENUMS`, `FEATURE_MAP`, `FEATURE_CATEGORIES` y las descripciones existentes. El catálogo visual vive en ese servicio y se consulta desde cualquier página; `advanced-settings.js` solo lo presenta. No existe otro almacén de preferencias.

- Preguntas: «¿Para qué sirve continuidad de conversaciones?», «¿Dónde estoy?», «lista las opciones avanzadas de memoria semántica».
- Navegación: «llévame a configuración de voz», «abre planificador semanal».
- Cambios: «desactiva humor contextual», «cambia velocidad de voz a rápida», «cambia segundos de silencio a 30 segundos». Se propone el cambio antes de guardar y se verifica la preferencia mediante el servicio existente.
- Una orden ambigua como «activa el planificador» pide elegir diario/semanal. Una orden con varios cambios no se aplica parcialmente.
- Voz y texto usan el mismo registro. La confirmación de un cambio hablado debe hacerse por escrito o en pantalla; no se conceden permisos del navegador ni acciones externas.
- Una cuenta distinta o una preferencia modificada después de la propuesta invalida la operación.

Las 18 políticas del Control Plane publican `advancedSchema` con tipos, rangos y unidades. El servidor vuelve a validarlos, rechaza revisiones obsoletas y conserva el estado predeterminado del módulo cuando se modifica únicamente un campo avanzado. Las políticas guardadas no demuestran por sí mismas que un motor esté activo ni conceden permisos a dispositivos.

Cuenta, contraseña, respaldos, núcleo visual, autorización del micrófono y conexiones se explican y localizan, pero requieren sus controles específicos: el chat no acepta credenciales ni promete modificar cualquier ajuste arbitrario. Los campos sin esquema de validación quedan en consulta, no en escritura.

Pruebas focalizadas: `node test/settings-awareness.js`; contratos existentes afectados: `node test/assistant-core.js '--filter=registro expone|toggles y campos avanzados|apariencia|ambig'`, `node test/voice-settings.js`, `node test/voice-preferences.js`.
