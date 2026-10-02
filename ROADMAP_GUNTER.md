# Hoja de ruta: Gunter como asistente residente

Fecha: 2026-08-28

## Diagnóstico ejecutivo

Gunter ya tiene una base considerable: conversación web, activación por voz, TTS,
memoria conversacional, tareas, calendario, notificaciones, reuniones,
transcripción, análisis de documentos, conocimiento de proyectos, WhatsApp,
acciones con confirmación, pulso proactivo, compromisos, forecast y personalidad.

Gunter todavía no cubre toda la visión de un asistente residente. La diferencia principal no es “ponerle otro
prompt”, sino convertir esas funciones separadas en un sistema continuo que
percibe, planifica, actúa, verifica y recuerda bajo una política de permisos.

## Bloqueadores actuales

1. **Proveedor de IA principal:** `OPENAI_API_KEY` no está configurada. Sin un
   modelo activo no funcionan chat, embeddings, transcripción OpenAI ni su TTS.
2. **Google Calendar:** falta `GOOGLE_CLIENT_ID`; la integración permanece
   desactivada hasta configurar OAuth.
3. **Voz en tiempo real:** ya existe VAD local, detección de fin de turno y
   *barge-in* semántico; aún falta audio bidireccional de baja latencia con un
   proveedor de streaming.
4. **Orquestación unificada:** existen acciones y servicios, pero falta un único
   registro de herramientas con esquemas de entrada/salida, permisos, timeout,
   reintentos, idempotencia y verificación del resultado.
5. **Ejecución persistente avanzada:** ya existe cola por usuario y scheduler para
   recordatorios y seguimientos. Faltan flujos multi-paso pausables y canales de
   entrega externos cuando ninguna pantalla de Gunter está abierta.
6. **Memoria gobernada:** la memoria actual es útil, pero debe separar memoria
   episódica, hechos, preferencias y tareas; incluir procedencia, caducidad,
   edición/olvido y cifrado de datos sensibles.
7. **Percepción multimodal:** faltan pantalla, cámara y contexto del dispositivo
   con consentimiento explícito y un indicador claro mientras se capturan.
8. **Integraciones de acción:** correo, domótica, archivos, escritorio y servicios
   externos aún no forman un ecosistema operativo completo.
9. **Observabilidad y evaluación:** faltan trazas por tarea, costo/latencia por
   modelo, métricas de éxito y una suite de evaluaciones para evitar regresiones.

## Arquitectura objetivo

```text
Web / móvil / WhatsApp / voz / pantalla
                 │
          Gateway de tiempo real
                 │
     Orquestador (estado de la tarea)
        ├── planificador
        ├── ejecutor de herramientas
        ├── verificador de resultados
        └── gestor de interrupciones
                 │
     Política y permisos ─── Registro de auditoría
          │                         │
 Herramientas/skills          Memoria unificada
          │                         │
 calendario · correo · archivos · dispositivos · reuniones
                 │
       Cola de trabajos + scheduler + eventos
```

## Componentes que conviene construir

### 1. Núcleo de voz continuo

- Streaming de audio de entrada y salida.
- VAD para detectar cuándo empieza y termina de hablar el usuario.
- Interrupción inmediata del TTS cuando el usuario vuelve a hablar.
- Estado explícito: `idle → listening → thinking → acting → speaking`.
- Fallback al reconocimiento y síntesis del navegador.
- Botón físico/visual de silencio y sesiones con duración limitada.

### 2. Registro único de herramientas

Cada herramienta debe declarar, como mínimo:

```js
{
  name: 'calendar.create_event',
  inputSchema: {},
  risk: 'write_external',
  requiresConfirmation: true,
  timeoutMs: 10000,
  execute: async (input, context) => {},
  verify: async (result, context) => {}
}
```

Las acciones de lectura pueden ser automáticas. Enviar mensajes, comprar, borrar,
publicar, mover dinero o controlar dispositivos debe requerir permiso proporcional
al riesgo y dejar una entrada de auditoría.

### 3. Orquestador durable

- Divide peticiones complejas en pasos y mantiene el estado en servidor.
- Puede pausar para pedir confirmación y continuar después.
- Reintenta sólo operaciones seguras o idempotentes.
- Comprueba el resultado real en vez de asumir que una llamada funcionó.
- Permite cancelar, deshacer cuando sea posible y explicar qué está haciendo.

### 4. Memoria tipo asistente personal

- **Episódica:** conversaciones y reuniones con fecha y fuente.
- **Semántica:** hechos confirmados sobre personas, proyectos y preferencias.
- **Procedimental:** rutinas que el usuario enseñó a Gunter.
- **Trabajo:** contexto temporal de la tarea activa.
- Panel “qué sabe de mí”, edición, exportación, olvido selectivo y retención.

### 5. Motor proactivo

- Bus de eventos: calendario, vencimientos, correo, WhatsApp y cambios de proyecto.
- Reglas y scheduler persistentes en servidor.
- Prioridad, horario silencioso, deduplicación y límite de notificaciones.
- Propuestas antes de ejecutar: “detecté X; ¿quieres que haga Y?”.

### 6. Percepción e integraciones

- Pantalla/cámara sólo bajo activación visible y consentimiento por sesión.
- Google Calendar completo; luego correo y archivos.
- Home Assistant o MQTT como capa de domótica, sin acoplar dispositivos al núcleo.
- Agente de escritorio separado y restringido para controlar aplicaciones locales.

### 7. Seguridad operacional

- Secretos fuera del repositorio y rotación periódica.
- Cifrado de datos sensibles en reposo.
- Roles, scopes y permisos por herramienta.
- Confirmación reforzada para acciones irreversibles.
- Registro consultable de quién pidió, aprobó y ejecutó cada acción.
- Protección contra instrucciones maliciosas dentro de documentos o páginas.

## Orden recomendado de implementación

### Fase 1 — Voz natural y orquestación mínima

1. Configurar un proveedor de IA válido.
2. Crear la máquina de estados conversacional.
3. Implementar streaming de voz, VAD y *barge-in*.
4. Migrar tres acciones reales al registro de herramientas: consultar agenda,
   crear evento y crear tarea.
5. Añadir traza y confirmación de cada acción.

**Criterio de salida:** una conversación de voz puede consultar la agenda, crear un
evento con confirmación, ser interrumpida y confirmar que el evento existe.

### Fase 2 — Agente que continúa trabajando

1. Cola durable y scheduler en servidor.
2. Tareas multi-paso con pausa, reanudación y cancelación.
3. Motor proactivo con horarios silenciosos y deduplicación.
4. Historial visual de ejecuciones.

**Criterio de salida:** Gunter completa un seguimiento programado aunque el
navegador haya estado cerrado y presenta evidencia del resultado.

### Fase 3 — Memoria confiable e integraciones

1. Modelo de memoria por capas y panel de control.
2. OAuth de Google Calendar y correo.
3. Archivos/documentos y búsqueda con citas a la fuente.
4. Home Assistant/MQTT si se desea controlar espacios físicos.

### Fase 4 — Visión y autonomía limitada

1. Contexto de pantalla/cámara con consentimiento.
2. Automatización de escritorio en entorno restringido.
3. Evaluaciones de seguridad, latencia y éxito por tarea.
4. Autonomía graduada por herramienta, nunca un interruptor global ilimitado.

## Incremento completado — llamados y contexto temporal

- Detector de invocación independiente para “Hola Gunter”, “Hi/Hey Gunter”,
  “Ok Gunter”, “Oye Gunter” y “Gunter”, con tolerancia a transcripciones
  fonéticas frecuentes.
- Respuestas de activación distintas y rotativas por familia de llamado.
- Separación entre la frase de activación y la orden para evitar enviar “Hola
  Gunter” como parte de la instrucción.
- Consultas de fecha, día, hora y zona horaria resueltas con el reloj real del
  dispositivo y una zona IANA, sin depender de un LLM.
- Comprensión temporal ampliada: “ahora”, “mañana a las diez y media”, “pasado
  mañana”, “mediodía” y “medianoche”.
- Protección contra ejecuciones duplicadas al pasar una orden de voz al pipeline.

## Incremento completado — conversación y herramientas verificables

- Máquina de estados compartida: reposo, escucha de activación, escucha de orden,
  procesamiento, respuesta hablada, confirmación pendiente y error.
- Interrupción (*barge-in*) sobre la reproducción actual, con filtro para no
  confundir la propia voz sintetizada de Gunter con la voz del usuario.
- Registro allowlist con herramientas reales para agenda, tareas, eventos,
  recordatorios, seguimientos, listado y cancelación de procesos.
- Confirmación obligatoria antes de crear eventos y cancelación sin efectos con
  “no”, “cancela” u “olvídalo”.
- Verificación posterior en IndexedDB: Gunter solo afirma que creó algo después
  de encontrar el registro persistido.
- Herramientas disponibles desde todas las pantallas principales.

## Incremento completado — VAD y procesos durables

- VAD adaptativo con Web Audio: analiza energía RMS localmente y no transmite el
  audio para detectar actividad.
- Inicio y fin de habla con *debounce*, umbral adaptativo y señal de posible
  interrupción mientras Gunter está hablando.
- Cola de trabajos persistente separada por usuario, recuperación después de un
  reinicio y ejecución periódica en servidor.
- Reintentos exponenciales, máximo de intentos, deduplicación, cancelación y
  evidencia del resultado.
- Comandos conversacionales para programar/listar/cancelar recordatorios y
  seguimientos; las cancelaciones requieren confirmación explícita.
- Pruebas de reinicio, reintento, aislamiento entre usuarios y flujo completo en
  navegador con “Hola/Hi/Oye Gunter”.

## Incremento completado — contexto unificado y continuidad offline

- Context Gateway conectado al pipeline conversacional y al proxy `/api/chat`.
- Fecha, hora, zona y ambigüedad viajan como metadatos confiables; el texto del usuario no se eleva a instrucción de sistema.
- Outbox Web persistente para operaciones explícitamente permitidas.
- Reproducción idempotente, deduplicación, detección de conflicto y límite de lote.
- Configuración mantiene cambios durante una desconexión y los sincroniza al regresar la red.
- Heartbeat del nodo Web reporta cursor de sincronización y salud del outbox.
- Operaciones de escritorio, mensajería, pagos y otras acciones sensibles no entran en replay automático.

## Incremento completado — flujos multipaso e historial operativo

- Coordinador persistente para objetivos de hasta 20 pasos, limitado al Skill Registry allowlist.
- Cada paso conserva la secuencia REQUESTED → UNDERSTANDING → PLANNING → AUTHORIZED → STARTED → RESULT_RECEIVED → VERIFYING → VERIFIED/FAILED.
- Acciones con impacto esperan confirmación explícita; el flujo no puede declararse completo sin evidencia verificable.
- Claims con lease e idempotency key estable permiten recuperar ejecuciones interrumpidas sin crear una identidad nueva para el mismo paso.
- Si vence un lease o falta evidencia después de una escritura/acción local, el resultado queda `OUTCOME_UNKNOWN`: Gunter no repite el efecto a ciegas, lo muestra en Actividad y requiere que la persona revise el destino y confirme un reintento potencialmente duplicado. Los pasos de solo lectura pueden reclamarse de nuevo automáticamente.
- Pausa, reanudación, cancelación y reintento explícito disponibles por API y desde Gunter Día.
- Nueva pestaña `Actividad`: resume ejecuciones activas, atención requerida y resultados verificados; la secuencia técnica se revela solo al expandirla.
- Historial unificado de flujos, Brain, comandos de nodos y recordatorios/seguimientos, siempre aislado por usuario.
- Borrado de cuenta ampliado para purgar también los flujos multipaso.

## Próximo incremento recomendado

Ejecutar el workflow de compilación nativa Android/iOS, corregir cualquier fallo,
integrar FCM/APNs para notificaciones y despertares compatibles con cada sistema,
firmar builds de distribución y probar permisos, límites de segundo plano,
reinicios y conectividad en dispositivos reales. Después, empaquetar y firmar el runtime de
escritorio para las plataformas objetivo. Para Instagram/Messenger, mantener
Beeper Desktop emparejado con la sesión del usuario y comprobar el estado antes
de mostrar o enviar conversaciones. Las publicaciones y mensajes siguen
conservando su confirmación explícita.

## Incremento completado — flujos naturales, conversaciones y rutas aprendidas

- Peticiones naturales multipaso proponen un plan legible y no producen efectos
  hasta ser aprobadas; cada paso se ejecuta por allowlist y conserva evidencia.
- Nueva bandeja `Conversaciones` que unifica WhatsApp y los futuros mensajes de
  Instagram/Messenger, con búsqueda, resumen extractivo y sugerencias de respuesta.
- Los borradores nunca se envían al seleccionarlos. El envío manual muestra el
  destinatario/texto y la orden natural espera confirmación explícita.
- Configuración incorpora activación/desactivación por red, QR de WhatsApp y estados
  honestos cuando faltan variables Meta o el adaptador todavía no está instalado.
- “Enseñar a Gunter” observa botones sin guardar texto escrito, contraseñas, tokens
  ni archivos; las rutas pasan por observación, simulación, aprobación y replay.
- La plantilla “último archivo descargado a Instagram” queda almacenada como una
  ruta semántica con confirmación de publicación y bloqueo explícito hasta disponer
  de un nodo Desktop y el adaptador Meta.

## Incremento completado — nodo residente, comunicaciones y alertas

- El nodo Windows se empareja con credenciales opacas y permisos revocables. Puede abrir aplicaciones, consultar y abrir archivos permitidos, controlar multimedia, inspeccionar controles accesibles y ejecutar rutas semánticas con esperas, desplazamiento, atajos permitidos y selección de archivo.
- Las operaciones que escriben, publican o modifican una aplicación siguen requiriendo confirmación explícita y devuelven evidencia para que el flujo no marque éxito por suposiciones.
- `Conversaciones` conecta Instagram y Messenger personales mediante Beeper Desktop cuando el usuario empareja su propio nodo. Puede leer, resumir, proponer respuestas y enviar texto o adjuntos después de la confirmación del usuario.
- Los recordatorios se guardan como trabajos durables y Web Push permite recibirlos aunque la pestaña no esté abierta. Cada dispositivo puede activarlo, probarlo y revocarlo desde Configuración.
- Existe un runtime móvil base que se empareja, informa sus capacidades y ejecuta solo deep links y acciones declaradas por su host nativo. Android e iOS todavía necesitan sus aplicaciones firmadas y los permisos del sistema.

## Requisitos para activar cada integración en un dispositivo real

- Emparejar Gunter Node en el PC y conceder únicamente las carpetas, aplicaciones e interacciones que el usuario quiera habilitar.
- Instalar y conectar Beeper Desktop con las cuentas personales compatibles para que Instagram/Messenger aparezcan en Conversaciones.
- Publicar la web por HTTPS y conceder la notificación del navegador para activar alertas en segundo plano.
- Compilar y firmar los hosts Android/iOS, implementar el puente indicado en `gunter-mobile/README.md` y solicitar los permisos desde cada dispositivo.
- Proporcionar credenciales OAuth cuando se habiliten Google Calendar u otros conectores externos.
