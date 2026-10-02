# Auditoría de implementación — Gunter v1.0

Fuente contrastada: `D:\MIS DOCUMENTOS USER\Downloads\Gunter_Especificacion_Funcional_Detallada_v1.0.docx`.

Fecha de corte: 2026-09-23. La especificación contiene 44 capacidades (A1–E2), cuatro matrices obligatorias (F1–F4) y un Definition of Done transversal.

## Resultado ejecutivo

- 44 capacidades registradas en un catálogo canónico consultable por API y visible en Configuración/Administración.
- La disponibilidad efectiva se calcula por usuario a partir de flags, plan, permisos y nodos emparejados.
- Las capacidades protegidas, nativas o externas exponen su condición de activación en lugar de simular disponibilidad.
- El nodo de PC y el núcleo móvil ejecutan exclusivamente capacidades declaradas, con evidencia y confirmación para acciones sensibles. El empaquetado firmado, los permisos de sistema y los adaptadores externos continúan siendo requisitos de despliegue.
- Las cuatro matrices F se aplican como reglas de riesgo, soporte, estado y trazabilidad del Control Plane.

## Cobertura funcional

| ID | Capacidad | Estado verificado | Superficie / condición |
|---|---|---|---|
| A1 | Gunter Now | Activo | Día Web |
| A2 | Chat contextual | Activo | Chat Web |
| A3 | Voz continua | Activo | Web; wake words y tiempo real probados |
| A4 | Tareas y recordatorios | Activo | Web + persistencia durable |
| A5 | Calendario y agenda | Activo | Web; integración externa parcial |
| A6 | Notificaciones y proactividad | Activo | Web Push por dispositivo, recordatorios durables y pulso proactivo |
| A7 | Meeting Copilot | Parcial | Falta transcripción/diarización conectada |
| A8 | Documentos y búsqueda | Parcial | Búsqueda local; conectores progresivos |
| A9 | Universal Inbox | Parcial | Bandeja, resumen, borradores y envío confirmado; Instagram/Messenger personales se sincronizan mediante Beeper Desktop emparejado |
| A10 | Configuración integrada | Activo | Web |
| B1 | Context Gateway | Activo | Contrato v1, usuario aislado, referencias y tiempo real |
| B2 | Brain Core | Activo | Plan individual y flujos multipaso persistentes |
| B3 | Skill Registry | Activo | Registro allowlist y contratos |
| B4 | Policy y autonomía | Activo | Confirmación por riesgo |
| B5 | Execution + Verification | Activo | No completa pasos ni flujos sin evidencia |
| B6 | Model Router | Activo | Cloud; local protegido |
| B7 | Cortex | Activo | Memoria gobernada |
| B8 | Knowledge Graph | Protegido | Implementado; flag/plan requerido |
| B9 | Mission Engine | Protegido | Implementado; despliegue gradual |
| B10 | Commitment Tracker | Activo | Web |
| B11 | Procedure Learning | Activo parcial | Grabación/replay Web y rutas semánticas de PC activas; simulación/aprobación obligatorias; móvil requiere host nativo |
| B12 | Attention Engine | Activo | Briefings y proactividad |
| B13 | Error Learning | Protegido | Candidatos revisables; sin autoaplicación |
| B14 | Skill Forge | Protegido | Propuesta/canary; autodeploy apagado |
| C1 | Desktop Runtime | Parcial | Nodo Windows emparejable, residente al iniciar sesión, con heartbeat, permisos revocables y ejecución allowlist; falta empaquetado firmado |
| C2 | Percepción de pantalla | Requiere app nativa | Permiso e indicador visible requeridos |
| C3 | Control de PC | Parcial | Apertura de apps, archivos, multimedia e interacción accesible con evidencia; confirmación y verificación requeridas |
| C4 | Browser Agent | Protegido | Pendiente sandbox y verificación visual |
| C5 | Mobile Runtime | Parcial | Núcleo y hosts Android/iOS con emparejamiento, comandos y evidencia; FCM opcional implementado para aviso/despertar Android; Android 15 limita `dataSync` a seis horas por 24 h; APNs no integrado; faltan compilación, firma y pruebas reales |
| C6 | Multimedia móvil | Parcial | El host Android usa sesiones multimedia cuando el usuario habilita el permiso correspondiente; depende de APIs y permisos del sistema |
| C7 | Mensajería móvil | Parcial | El host Android abre borradores confirmados; el envío directo depende del rol SMS predeterminado o de un conector autorizado |
| C8 | Sensores móviles | Requiere app nativa | Permiso por sesión |
| C9 | Connection Manager | Parcial | Outbox Web idempotente activo; sync nativa pendiente |
| C10 | Integraciones externas | Parcial | WhatsApp integrado; Instagram/Messenger personales usan Beeper Desktop + Gunter Node, sujeto a sesión y compatibilidad del proveedor |
| D1 | Billing recurrente | Requiere proveedor | Dominio listo; faltan pago y webhooks firmados |
| D2 | Entitlements/licencia offline | Activo | Snapshot y lease firmado |
| D3 | Device Registry | Activo | Registro, heartbeat, revocación |
| D4 | Admin Accounts | Activo | Web admin |
| D5 | Operations Center | Activo | Web admin |
| D6 | Logs, traces y auditoría | Activo | `trace_id` y redacción |
| D7 | Incidentes y alertas | Activo | Correlación y recuperación |
| D8 | Flags, releases y rollback | Parcial | Flags/canary activos; workflow nativo de compilación agregado, pendiente primera ejecución; CI/CD y rollback de releases externos pendientes |
| E1 | Seguridad y privacidad | Activo | Aislamiento, permisos y protección HTTP |
| E2 | QA y Definition of Done | Activo | Suite automatizada y revisión responsive |

## Correcciones implementadas en esta fase

1. Catálogo único de capacidades con estado, flag, entitlement, superficie, soporte offline y bloqueo explícito.
2. Context Gateway v1 con `context_id`, `trace_id`, hash de usuario, fuente, zona horaria, resolución de “hoy/mañana”, horas y referencias como “hazlo”.
3. Knowledge Graph por usuario con fuente y confianza obligatorias; no fusiona entidades parecidas automáticamente.
4. Error Learning con redacción de secretos, estados revisables y prohibición de autoaplicar cambios protegidos.
5. Nuevas rutas API, contratos, flags y controles de plan para esas capacidades.
6. Mapa funcional integrado en Configuración y resumen de preparación integrado en Administración.
7. Borrado de cuenta ampliado a nodos, comandos, ejecuciones, leases, suscripciones, contexto, grafo y aprendizaje gobernado.
8. Context Gateway conectado al pipeline y al proxy de chat con metadatos confiables de fecha, hora, zona y ambigüedad.
9. Connection Manager Web con outbox persistente, allowlist, deduplicación, conflictos y recuperación automática.
10. Coordinador durable de flujos multipaso con idempotencia, confirmación por riesgo, lease de ejecución, pausa, reanudación, reintento y cancelación. Un lease vencido o una verificación perdida en una escritura ya no repite el efecto automáticamente: queda como resultado incierto, exige revisión y confirmación explícita; los pasos de solo lectura sí pueden recuperarse automáticamente.
11. Historial operativo unificado de flujos, Brain, comandos y procesos, visible en la nueva pestaña `Actividad` de Gunter Día con evidencia bajo demanda.
12. Bandeja `Conversaciones` para WhatsApp, Instagram y Messenger, con lectura contextual, borradores no ejecutables y envío sujeto a orden/confirmación explícita.
13. Centro de conexiones con interruptores por proveedor y estados honestos: conectado, desactivado, configuración requerida o adaptador pendiente.
14. Procedure Learning Web operativo: observa objetivos semánticos, omite valores/secretos, simula el DOM, exige aprobación y reproduce rutas supervisadas.
15. Comandos naturales de mensajería social integrados al allowlist; contacto, canal y texto se muestran antes de ejecutar.
16. Nodo Windows con automatización semántica de aplicaciones, archivos, atajos seguros, desplazamiento, espera y selector de archivo; cada acción devuelve evidencia para su verificación.
17. Integración Beeper Desktop para conversaciones personales de Instagram/Messenger, adjuntos de hasta 100 MB y envío siempre confirmado desde Conversaciones.
18. Web Push con claves VAPID, suscripciones aisladas por usuario, recordatorios durables y baja automática de endpoints vencidos.
19. Hosts nativos Android (Kotlin) e iOS (SwiftUI), con emparejamiento de un solo uso, credenciales protegidas por Keystore/Keychain, transporte HTTPS, loop de comandos, apertura de apps, multimedia, acceso a una carpeta seleccionada, vista de archivos, preparación de mensajes y recordatorios locales. Android permite iniciar/detener el servicio; recordatorios móviles reutilizan el ID del comando para tolerar reintentos. iOS solo mantiene el nodo activo en primer plano; los recordatorios requieren que el usuario active notificaciones desde la app. Las capacidades concretas dependen del SO y sus permisos.

## Verificación

- 34 pruebas automatizadas del núcleo de Gunter.
- 5 pruebas de procesos durables y Web Push.
- 32 pruebas del Control Plane.
- 12 pruebas del nodo de PC.
- 4 pruebas del runtime móvil, incluidas las cotas de búsqueda y saneamiento de nombres/tokens de archivo.
- 1 prueba del emisor FCM HTTP v1 para revisar firma OAuth, destinatario y que el push no incluya el contenido de la orden.
- 147 pruebas smoke/end-to-end y de seguridad.
- Total: 235 aprobadas, 0 fallidas en la última ejecución de `npm test`; `npm run preflight` aprobado. La compilación nativa y los proveedores/dispositivos reales continúan pendientes de validación.
- Revisión visual real en escritorio y 390×844 de Actividad, Conversaciones, Conexiones y Rutas aprendidas; grabación → simulación → aprobación → replay verificados sin excepciones propias. Permanece el 403 esperado del Tutor cuando la cuenta no tiene ese permiso.
- Prueba de red real: ajuste en offline → outbox pendiente → reconexión → aplicación única verificada en servidor.

## Dependencias reales pendientes

- Empaquetado y firma del runtime Desktop para Windows/macOS y de los hosts Android/iOS. El workflow de compilación nativa está agregado pero todavía no se ejecutó en GitHub; faltan compilar allí, firmar releases y probar permisos/comportamiento en dispositivos. Este entorno Windows no dispone de Xcode ni Android SDK/Gradle/ADB.
- Activar y probar FCM Android con `google-services.json` y `FCM_SERVICE_ACCOUNT_JSON`; integrar APNs/FCM para iOS. El sondeo Android está limitado por la cuota `dataSync` de Android 15 y iOS opera en primer plano.
- Proveedor de billing con webhooks firmados.
- Proveedor de transcripción/diarización. Beeper Desktop debe estar instalado, emparejado y mantener la sesión personal de Instagram/Messenger compatible.
- Pipeline CI/CD para releases y rollback automático.
- Habilitación gradual de Graph, Missions, Error Learning y Skill Forge después de canary y evaluación.
