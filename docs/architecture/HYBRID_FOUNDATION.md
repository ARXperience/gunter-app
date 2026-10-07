# Base híbrida reversible — 2026-10-04

> Fase posterior (2026-10-06): [LOCAL_STT.md](LOCAL_STT.md) integra Moonshine solo para transcripción en Windows. El mapa y el texto histórico de esta fundación describen su estado anterior: STT ya no es un stub si modelo/runtime están instalados y `stt.local` está activo. AUTO/CLOUD y el rollback de la fundación permanecen intactos.

> Fase posterior (2026-10-05): [LOCAL_BRAIN.md](LOCAL_BRAIN.md) integra únicamente chat de texto local tras superar gates; este documento conserva el estado histórico de la fundación. AUTO/CLOUD no se alteran y STT/TTS/embeddings continúan como stubs locales.

Estado: **fundación, no migración de motores ni datos**. La ruta por defecto `AUTO/STANDARD` sigue usando los endpoints y proveedores existentes. Ningún modelo local, SQLite, sincronización general ni shell nuevo se instala o activa con esta fase.

## Punto de restauración

- Rama: `feature/gunter-hybrid-foundation` (partió de `9ff5ef38c0037699f91f6cfdc17eaca96329906b`).
- El checkout ya contenía cambios del usuario. Se preservaron: snapshot Git de los archivos rastreados `afcf6486915145ffabeeefe95d47e57f8ab9578d`, fijado en `refs/backup/gunter-hybrid-foundation-pre-20261004`, y archivo de los documentos previamente no rastreados en `gunter-foundation-pre-20261004-docs.zip` en la carpeta hermana. No se hizo reset ni se eliminaron cambios del usuario.
- Rollback funcional inmediato: `AUTO` + `STANDARD`; los cinco flags nuevos permanecen `off`. No se requiere cambiar stores ni importar datos.

## Mapa de consumidores y continuidad

| Función actual | Abstracción extendida | Proveedor/estado inicial | Estado del consumidor |
| --- | --- | --- | --- |
| Chat y razonamiento común | `GunterBrainRouter` sobre `GunterNlpLlm.complete`; `model-router.resolveHybrid` en servidor | `/api/chat` y cloud actual | `GunterNlpLlm` y Companion: migrado; `analyses-engine`, `slide-generator`, análisis de reunión y resultados: legado intencional protegido por el gate central del servidor |
| Chat `generate/stream/health/cancel` | `CloudBrain` y `LocalBrain` | Cloud actual; local `NOT_INSTALLED` | `stream` es adaptador de compatibilidad de un solo bloque, **no** streaming por tokens |
| Voz sintetizada | `GunterVoice.providers` | `/api/tts`, fallback del navegador; local `NOT_INSTALLED` | Servicio de voz: migrado; alias histórico `voice-adapter.local` refiere al adaptador web, no a un modelo TTS local |
| Transcripción | `GunterSTT` y gate de `/api/transcribe` | Whisper cloud actual; local `NOT_INSTALLED` | Captura de reunión, `new-project`, `results`, `audio-vault` y `session-recovery`: migrados a la misma fachada |
| Embeddings | `GunterEmbeddings` y gate de `/api/embeddings` | Cloud actual; local `NOT_INSTALLED` | Servicio de embeddings: migrado; caché/vector 1536 y store existentes intactos |
| Estado | `GunterRuntimeState` en monitor de conectividad y `/api/control/hybrid/status` | Red + backend + preferencias del usuario + catálogo | Diagnóstico interno, sin dashboard falso de telemetría |
| Herramientas de dispositivos | `skills.authorizeProposal` y `nodes.queueCommand` | Registro/entitlements/confirmación existentes | Puerta determinista ampliada; el LLM no ejecuta por sí solo |
| Datos | `GunterDataRepository` (contrato) | `WebRepository` delega a un store existente; `SQLiteRepository` `NOT_CONFIGURED` | Ningún consumidor migrado todavía; ninguna base abierta |
| Sync | `sync.CONTRACT_VERSION=1`, outbox actual | Solo `settings.patch` | Operaciones desconocidas/versiones futuras rechazadas; la cola antigua sin versión sigue válida |
| Respaldo | `backup.inventory/createTestManifest/validateTestManifest` | Inventario sin contenido y prueba ficticia SHA-256 | Backups reales programados permanecen igual; export/restauración del navegador aún no configurados |

## Modos y privacidad

- `AUTO` y `CLOUD` con `STANDARD`: misma ruta cloud actual, sin alterar payload ni modelos.
- `LOCAL`: responde `503 LOCAL_MODEL_NOT_INSTALLED` en endpoints AI; nunca finge un modelo instalado aunque exista una URL en entorno.
- `LOCAL_ONLY`: responde `503 LOCAL_PROVIDER_NOT_INSTALLED` **antes** de procesar audio/texto/imágenes de los endpoints cloud cubiertos. TTS tampoco cae silenciosamente al navegador cuando recibe este código. Otras capacidades no-AI siguen sujetas a sus permisos propios; esto no es un interruptor general de todas las integraciones externas.
- Flags `ai.local`, `stt.local`, `tts.local`, `embeddings.local`, `hybrid.routing`: `off` por defecto. El simple cambio de flag no instala ni verifica un proveedor.
- La sesión autenticada determina el usuario del modo; no se fía de un userId enviado por un usuario normal. `GET /api/control/hybrid/status` y `POST /api/control/hybrid/mode` son los endpoints diagnósticos/de preferencia. El runtime expone `networkAvailable`, `backendAvailable`, disponibilidades cloud/local por clase y `syncAvailable`, sin inferirlas solo de `navigator.onLine`.

## Contratos y seguridad

Errores normalizados nuevos: `LOCAL_MODEL_NOT_INSTALLED`, `LOCAL_PROVIDER_NOT_INSTALLED`, `INVALID_HYBRID_MODE`, `INVALID_PRIVACY_MODE`, `PROVIDER_NOT_SUPPORTED`, `SQLITE_NOT_CONFIGURED`, `unsupported_sync_contract`, `operation_not_allowlisted`, `invalid_skill_arguments`. El mapeador web ofrece explicación en español para los tres estados locales/de datos.

El gate de acciones valida skill en allowlist, usuario, tipo de nodo, flag, entitlement, autonomía, confirmación y objeto de argumentos serializable acotado; rechaza claves peligrosas/profundidad excesiva. Impactos conceptuales: `READ_ONLY`, `LOCAL_LOW_RISK`, `LOCAL_SENSITIVE`, `CLOUD`, `EXTERNAL_SIDE_EFFECT`. El schema por skill sigue siendo genérico (`object`); faltan esquemas específicos de cada comando y una revisión de permisos por plataforma antes de conectar un LLM a ejecución directa. No se afirma que este gate habilite autonomía general.

El inventario de backup enumera nombres conocidos de IndexedDB/localStorage y directorios JSON/JSONL sin leer secretos ni contenido; no es exhaustivo. El manifiesto SHA-256 es solo para datos de prueba. Pendientes: exportación real de browser, cifrado/retención verificada, restauración, migración reversible de datos y pruebas en dos dispositivos. El contrato `DataRepository` no sustituye los stores actuales. Sync no replica tareas/conversaciones ni reejecuta efectos externos.

## Validación y límites

Antes del cambio: assistant 50/50, control 33/33, mobile 4/4, node 12/12, jobs 5/5, smoke 139/139, E2E 1/1. Después: `npm run test:hybrid`, `npm run test:control`, `npm test`, `npm run test:e2e`. La E2E agregó bloqueo de chat/STT/TTS/embeddings/Gemini y retorno a AUTO. Durante la ejecución se detectó intermitencia previa por enviar una tecla al foco global de Configuración; la prueba ahora pulsa sobre la pestaña específica y volvió a pasar. No se ha validado un modelo/STT/TTS local real ni hardware Windows/Android/iOS en esta fase. No se ha probado export/restauración productiva. Esos trabajos requieren gate separado y evidencia.
