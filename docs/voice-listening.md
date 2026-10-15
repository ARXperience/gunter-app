# Escucha por nombre y respuestas de voz

Configuración → Voz y escucha mantiene dos elecciones independientes:

- **Respuestas por voz**: todas las respuestas, solo tras decir su nombre,
  solo notificaciones o solo texto. Seleccionar un modo aplica una elección
  coherente; abrir la página no modifica preferencias guardadas.
- **Activación por voz**: continua o manual, palabra de activación y respuesta
  hablada/escrita. Desactivar la salida de voz no apaga la escucha ni el chat.

En modo continuo, un permiso de micrófono ya concedido y un runtime listo
permiten reanudar la captura automáticamente. La autorización inicial requiere
interacción. Los navegadores sin consulta de permisos pueden exigirla de nuevo
tras recargar; no se fuerza una solicitud oculta. No se garantiza escucha con
la aplicación cerrada, pantalla apagada o suspendida por el sistema.

La pausa explícita y el modo manual se conservan. Dictado y grabación de una
reunión mantienen la propiedad exclusiva del micrófono y luego liberan la
escucha. En LOCAL_ONLY, Moonshine debe estar listo: no se cambia a cloud.

`GunterVoice.shouldSpeak` es la política común para respuestas completas,
streaming, feedback y cola. `force` no elude una preferencia desactivada ni las
restricciones de reuniones. Las conversaciones se leen completas en segmentos;
un error conserva el texto y publica su causa en `getPlaybackState().error`.
El indicador «Hablando» sigue reproducción real, no la llegada de texto.

Validación focalizada: `test/voice-reply-policy.js`, `test/voice-settings.js`,
`test/wake-autostart.js`, `test/local-wake-browser.js`,
`test/default-activation.js`, `test/presence-voice.js` y
`test/core-audio-levels.js`. Controles reales verificados en navegador aislado
a 1.100 y 390 px; no se alteraron cuentas ni se generó voz nueva.

Pendiente: prueba con micrófono y voz humana del usuario en su navegador. Los
contratos y pruebas aisladas no sustituyen esa comprobación de hardware/STT.
Reversión: revertir el commit completo, incluidas sus versiones de caché.
