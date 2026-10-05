# Local Brain — Ministral 3 3B (texto)

Estado: integrado en `feature/gunter-localbrain` desde `67ba9a9251d81c1f771418f58cef900da894944f` tras superar el gate aislado. `main` y el tag de respaldo de la fundación permanecen intactos. No hay STT, TTS, wake word, móvil ni control autónomo nuevo en esta fase.

## Modelo y runtime fijados

| Elemento | Valor |
| --- | --- |
| Autor/origen | Mistral AI, [GGUF oficial](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF), derivado de `mistralai/Ministral-3-3B-Instruct-2512` |
| Revisión del repositorio | `eb599d408350ea2bb60452cb86be7c7b2fc28227` |
| Archivo | `Ministral-3-3B-Instruct-2512-Q4_K_M.gguf` |
| Cuantización/tamaño | `Q4_K_M`, 2 147 023 008 bytes |
| SHA-256 | `9ed150d4367e68df0ac8e1540f6ddc65b42d0ee26378329d1ecbca60f93fc5f8` (coincide con el LFS OID oficial) |
| Licencia | Apache-2.0 |
| llama.cpp | release oficial `b11399`, commit `2ca15f5404760548c39e7b92bd43116a09414a1a`, Windows CPU x64; ZIP SHA-256 `ef5afeab664baca771849c9a8821617aec8d18eac744aaee0d04f6cf96434d9a` |
| Chat template | Jinja incluido en el GGUF; `--jinja` por defecto en b11399, sin plantilla personalizada |
| Validación | 2026-10-05, Windows x64, Ryzen 5 5500U, CPU, 19,39 GB RAM |

No se empaquetan GGUF ni binarios de llama.cpp en Git/npm/installer. El archivo descargado para la validación reside en `D:\gunter-localbrain-validation\`; esa ruta no forma parte del producto ni debe suponerse en otros equipos. El manifiesto versionado en `server/models/` fija la identidad/hash. Antes de cada arranque se verifica tamaño y SHA-256; una URL o un archivo cualquiera no se consideran modelo listo.

## Reproducción del gate aislado

La suite es la PoC previa `../gunter-validation-poc/llm-gates.mjs`, versionada también en `test/validation/local-brain-120.mjs`, sin cambios en los 120 casos, respuestas esperadas, puntuación, system prompt optimized-v2 ni barrera determinista. Solo se añadió un transporte para llama.cpp. Los 120 prompts, respuestas y puntuaciones están en [evidence/local-brain-120.json](evidence/local-brain-120.json) (copia de la salida aislada). `npm run test:local:gate` permite repetirla con el servidor de validación y las variables `GUNTER_GATE_BACKEND=llama`, `GUNTER_LLAMA_ENDPOINT`, `GUNTER_LLAMA_API_KEY`; el test de producto `test/local-brain-core.js` no reemplaza el benchmark.

Servidor de validación: `llama-server.exe --model <GGUF> --alias ministral-3:3b --host 127.0.0.1 --port 18081 --ctx-size 4096 --threads 6 --threads-batch 6 --batch-size 512 --parallel 1 --no-webui --no-mmproj --offline`, con `LLAMA_API_KEY` temporal aleatoria en entorno. La suite usó `/v1/chat/completions`, streaming, temperatura 0, `max_tokens=120`, `response_format=json_schema`, el mismo schema y el mismo few-shot de optimized-v2; `chat_template_kwargs.enable_thinking=false`. Los campos propuestos son JSON; ninguna herramienta real estuvo conectada.

| Medida | Resultado / mínimo exigido |
| --- | ---: |
| Exactos | 109/120 / ≥100 |
| JSON conforme al schema | 120/120 / ≥115 |
| Selección de herramienta | 120/120 / ≥110 |
| Argumentos válidos | 119/120 |
| Acciones no autorizadas ejecutadas | 0 |
| Latencia media / primer contenido (TTFT) | 6 744,6 ms / 1 005,9 ms |
| Generación media | 9,1 tokens/s |
| Fallos de proceso / respuestas vacías recurrentes | 0 observados |

Diez errores exactos fueron conversaciones generales clasificadas como `refuse` pese a pedir ayuda sin datos; el restante fue navegación. Es un límite real del modelo/prompt, no una autorización para relajar el gate. La primera respuesta tuvo TTFT frío de ~8 s; la media mezcla caché de prompt y generación. Carga directa del modelo ~3,6 s; supervisor con hash/arranque/health ~6,4 s en un ensayo. Proceso Gunter sin modelo: ~63 MB del servidor Node y ~67 MB del nodo auxiliar; llama-server cargado/generando ~3,85–3,94 GB de working set, memoria libre del sistema ~8,96 GB antes y ~4,97–5,23 GB durante. Muestra de CPU durante 3 s de generación larga: ~611 % de un núcleo, equivalente a ~51 % de los 12 hilos lógicos; no es un promedio sostenido. Una petición larga de 512 tokens alcanzó el timeout de 90 s y fue abortada; no fue una caída de llama.cpp. No se midió consumo eléctrico ni rendimiento móvil.

## Activación manual y modos

En este PC existe `data/local-brain.json` (ignorado por Git) con `modelPath` y `runtimePath` absolutos. Alternativa: `GUNTER_LOCAL_MODEL_PATH` y `GUNTER_LLAMA_SERVER_PATH` en el entorno de Gunter; el entorno tiene prioridad. Deben apuntar a archivos locales absolutos fuera del repositorio. No se aceptan rutas suministradas por el navegador. El flag `ai.local` sigue `off` por defecto: un administrador puede activarlo en Configuración → Asistente IA → Modo de inteligencia; ahí también puede iniciar o detener el motor. El usuario elige AUTO, CLOUD o LOCAL y privacidad estándar o LOCAL_ONLY en el mismo panel. `AUTO` y `CLOUD` continúan por la nube actual. `LOCAL` usa solo Ministral para `/api/chat`; `LOCAL_ONLY` prohíbe la nube. STT/TTS/embeddings locales continúan sin instalar.

`GET /api/control/hybrid/status` publica `localBrainInstalled`, `localBrainRuntimeAvailable`, `localBrainReady`, `localBrainModel`, `localBrainError`. `READY` requiere respuesta autenticada de `/v1/models` con alias correcto, no solo existencia de URL. Un administrador autenticado puede llamar `POST /api/control/local-brain/start|stop|restart`. La primera petición de chat local también inicia el proceso. El supervisor usa un puerto loopback aleatorio (o `GUNTER_LOCAL_PORT` para pruebas), token efímero de 256 bits, UI deshabilitada y `--offline`. Gunter controla su ciclo de vida; el navegador nunca ve token ni puerto. Las rutas API de Gunter siguen pasando por sesión, origen y limitación de tasa.

El endpoint local acepta únicamente mensajes de texto `system/user/assistant` acotados y formatos JSON acotados. El LLM devuelve texto o una propuesta estructurada; `validateProposal()` limita herramientas/argumentos y **no ejecuta** ninguna. Las acciones reales siguen pasando por `skills.authorizeProposal`, Permission Gate, confirmación y dispatcher. Enviar mensajes exige confirmación separada. Una caída/interrupción responde `LOCAL_PROVIDER_UNAVAILABLE`; modelo ausente responde `LOCAL_MODEL_NOT_INSTALLED` en LOCAL. No hay fallback silencioso a cloud.

## Pruebas y recuperación

- `npm test` y `npm run test:e2e`: regresión existente; `npm run test:local`, `npm run test:hybrid`: contratos nuevos.
- Con rutas de modelo/runtime configuradas: `npm run test:local:live`: health, generación, cancelación, matar proceso durante respuesta, restart, puerto ocupado, runtime/modelo ausentes. Pasó en este PC.
- `npm run test:local:offline` y `npm run test:local:offline-server`: HTTP(S) externo denegado en el proceso de prueba; texto, contexto y propuesta sin ejecución funcionaron. La segunda prueba usó sesión autenticada, LOCAL+LOCAL_ONLY y bloqueó `/api/gemini-text`. Esto es aislamiento de egreso del proceso, **no** una desconexión física de Windows ni cobertura de cada integración que use sockets directos.
- Modelo corrupto/tamaño erróneo y sin modelo se rechazan. RAM insuficiente no se simuló de manera fiable.

Rollback: desactivar `ai.local` o volver a `AUTO`/`CLOUD`; `stop` detiene llama.cpp. No se migraron datos. El GGUF puede quedar instalado sin afectar cloud. Para retirar archivos manualmente, detener primero el runtime y verificar la ruta exacta; no se eliminan automáticamente.

Pendiente: grabación de voz real para una fase posterior; mediciones de CPU/energía sostenidas y hardware Android/iOS; test de desconexión física/Firewall de todo el host; endurecer autorización de propuestas específicas para cada skill antes de conectar la planificación local a acciones; gestión de instalación/actualización/desinstalación del modelo; evaluación de respuesta conversacional más allá del gate JSON.
