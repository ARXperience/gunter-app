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

## Corrección de preferencias cruzadas

Se reprodujo en la pestaña real una selección «Todas las respuestas con voz»
junto con la restricción antigua «solo tras el nombre» y respuesta por nombre
en texto. El motor estaba disponible, pero la política bloqueaba ambos canales.
Se elimina el interruptor duplicado: el modo efectivo aparece seleccionado y
la excepción por nombre vive en la misma tarjeta de salida. Las mutaciones de
preferencias se reconcilian atómicamente; cargar/importar no anula elecciones
guardadas. Las otras pestañas reciben los cambios sin sobrescribirlos.

La sincronización existente con el servidor local debe conservar el conjunto
coherente de preferencias de voz, no devolver solo el booleano maestro y luego
reponer restricciones antiguas. No se agrega sincronización cloud.

«Probar voz» es una solicitud explícita con contexto `voice-preview`: conserva
apagado global, modo texto y silencio en reuniones, pero no exige pronunciar
el nombre. Muestra preparación, reproducción, finalización o error a partir
de eventos reales. Finalizar la reproducción no demuestra que el volumen del
sistema o el dispositivo de salida sean audibles para el usuario.

Se corrige también la visibilidad del panel existente de motores: CSS y JS
deben mostrarlo en Asistente e IA. La disponibilidad del micrófono local incluye
el interruptor `stt.local`, no solo la presencia del modelo. En este PC se
reutilizaron los pesos Moonshine aprobados mediante configuración local privada
y se habilitó su interruptor desde el panel administrador; no se descargaron
pesos ni se alteró el proveedor de chat o la privacidad elegida.

Verificación real (15 de octubre): se inició el servidor local, Supertonic M1
quedó listo y la prueba explícita terminó mediante eventos reales de reproducción
del navegador. «Todas las respuestas con voz» se mantuvo después del siguiente
sondeo y de recargar. Se seleccionó escucha continua; el navegador indicó permiso
pendiente, no captura activa. La audibilidad física y una orden con la voz humana
del usuario requieren su comprobación y autorización del micrófono. No se aceptó
ningún permiso automáticamente.

Los errores HTTP conservan los códigos locales, incluido `LOCAL_TTS_BUSY`.
Una síntesis que eligió Supertonic no cambia a otra voz ante fallo. El cliente
permite el plazo ya existente del servidor (6 s de preparación + 12 s de
síntesis, con 2 s de margen); no es una garantía de latencia ni un benchmark.
Solo una cancelación local reciente permite un reintento ocupado, abortable,
tras 350 ms. Silenciar/interrumpir cancela también esa espera y la precarga.

### Continuidad y cortes de voz

Cada frase local se cierra mediante `MediaRecorder.stop()` y su evento `stop`:
incluye la cabecera del contenedor y el último bloque de audio. Se reinicia el
grabador sobre el mismo micrófono; los intervalos silenciosos se rotan completos,
sin descartar cabeceras WebM/Ogg. El bloqueo de STT termina antes de esperar al
LLM/TTS; una cola acotada permite recuperar frases que llegan mientras transcribe.
Parar o revocar la escucha aborta la transcripción y descarta esa cola.

Con continuidad habilitada, los siguientes turnos no exigen repetir el nombre
dentro de la ventana configurada. El reinicio del reconocimiento conserva esa
ventana; una pausa breve no corta la frase al retomarla. Al terminar la voz
se renueva la espera. El modo manual y la continuidad desactivada se respetan.

Ocultar la pestaña ya no pausa la respuesta: se suspende solo el medidor visual.
Un historial efímero y acotado del texto realmente reproducido filtra eco tardío
y entre segmentos; llamadas explícitas y «para» conservan la interrupción.
No garantiza captura con la pantalla apagada ni elude restricciones del SO.

Pruebas: `voice-conversation-continuity.js`, `local-wake-browser.js`,
`wake-autostart.js`, `voice-reply-policy.js` y `presence-voice.js` en `test/`.
Son verificaciones deterministas de eventos; no sustituyen escuchar el dispositivo.
