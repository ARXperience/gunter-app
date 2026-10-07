# Validación técnica del stack local/offline de Gunter

> Actualización 2026-10-06: Moonshine Spanish Small Streaming pasó el mini-gate del runtime nativo y se integró **solo para transcripción** en rama separada, con flag desactivado por defecto y confirmación de cualquier efecto originado por voz. Véase [LOCAL_STT.md](LOCAL_STT.md). Los resultados provisionales de 2026-10-04/05 no describen este estado nuevo. TTS, wake word local y móvil continúan pendientes.

> Actualización 2026-10-05: Ministral 3 3B Q4_K_M **sí** pasó la suite completa directamente sobre llama.cpp b11399 y se integró solo como LocalBrain de texto en una rama separada. Resultado: 109/120 exactos, 120/120 JSON, 120/120 selección de herramienta, 0 acciones no autorizadas. Véase [LOCAL_BRAIN.md](LOCAL_BRAIN.md) para el ensayo, parámetros, hash, mediciones, offline y límites. Las conclusiones provisionales de este documento describen la fase anterior y no sustituyen la decisión nueva para LLM de texto. STT/TTS/wake/mobile siguen sin integrar.

Fecha: 2026-10-04. Estado: **PoC aislada completada en Windows; decisión de integración pendiente**. Esta validación no cambia proveedores, rutas, datos ni dependencias de la aplicación. Las mediciones son una muestra pequeña, no una garantía de calidad ni de rendimiento en otros equipos. **La sección «Cierre de gates» al final actualiza y prevalece sobre los candidatos provisionales y gates pendientes de la validación inicial.**

## 1. Alcance y regla de decisión

Se compararon inferencia LLM, STT, TTS, wake word, memoria local, sincronización y contenedores Windows/Android/iOS para una experiencia que funcione sin Internet. La condición para integrar sigue siendo la Regla 0 de [DECISIONS.md](DECISIONS.md): compatibilidad demostrada, PoC aprobada, licencia, costo esencial $0, respaldo, rollback, impacto y pruebas. **Ningún componente nuevo supera aún todos esos gates**. «Candidato» no equivale a «aprobado».

Se mantuvieron intactos el servidor Node/CommonJS, la PWA, la automatización Windows y los proyectos nativos. Las PoC y sus modelos/audio están en una carpeta temporal local (`gunter-validation-20261004`), fuera del repositorio; Windows puede limpiar esa carpeta. No se enviaron datos privados a APIs de IA para estas mediciones.

## 2. Equipo, entorno y reproducibilidad

| Elemento | Observación local |
|---|---|
| Sistema | Windows x64, compilación 10.0.26200; AMD Ryzen 5 5500U; 19,39 GB RAM |
| GPU | Radeon integrada; el reporte de 0,5 GB de VRAM dedicada no describe la memoria compartida. PoC medida en CPU |
| Herramientas | Node 24.15.0, npm 11.12.1, Python 3.11 para venv de voz, Java 19.0.1; Ollama 0.32.1; llama.cpp Windows CPU b11388 |
| Móviles | SDK Android/Gradle wrapper presentes, pero `adb` sin dispositivos. Sin macOS/Xcode ni iPhone; ninguna medición móvil |
| Configuración LLM | 4 prompts en español, temperatura 0, contexto 2048, máximo 120 tokens, `think:false`, streaming, mismo equipo; Ollama local para comparación; prueba directa de llama.cpp separada |
| Configuración STT/TTS | Archivos WAV de frases exactas; síntesis y transcripción completas (no latencia al primer paquete de audio); medidas de reloj y RSS del proceso |

El espacio libre en C: era ~22,6 GB al inicio y bajó durante las descargas de modelos. El tamaño instalado puede superar el peso nominal del modelo por dependencias/caché. **No se midieron energía, batería, temperatura sostenida, memoria pico del sistema ni rendimiento multisesión**.

## 3. Arquitectura actual y puntos de acoplamiento

`server.js` y `server/control-plane/model-router.js` enrutan servicios online y contienen un lugar para `local.fast`, todavía no validado como stack offline. `js/services/voice-service.js` utiliza TTS del servidor/navegador; `js/services/wake-word-service.js` depende de Web Speech cuando está disponible, sin garantía offline. `js/transcription-service.js` y `js/services/transcript-store.js` usan IndexedDB para medios/transcripciones. `js/services/connection-manager.js` tiene una cola local limitada para `settings.patch`; no es sincronización general de reuniones, conversaciones ni acciones. La PWA y sus assets se cachean parcialmente, pero eso no convierte IA, voz o integraciones sociales en offline. Los hosts `gunter-mobile/android/` y `gunter-mobile/ios/` son nodos nativos, no shells WebView completos del producto. `gunter-node/` y `server/actions/dispatcher.js` ejecutan acciones de PC con permisos existentes. Por tanto, la integración futura debe ir detrás de interfaces de proveedor y permisos por acción, sin sustituir rutas productivas hasta validar contratos y fallos.

## 4. LLM: mediciones y resultado funcional

Los tamaños de la tabla son los que reportó `ollama list`; tiempos por solicitud incluyen carga fría cuando aplica. La «primera salida» es primer fragmento de contenido **o** tool call, no necesariamente primera palabra audible. En `tool_call`, la plantilla puede demorar casi toda la generación antes de emitir la llamada.

| Modelo | Peso | Carga inicial | Primera salida en `prioritize` | Velocidad evaluación | Pruebas correctas/4 | Fallo decisivo |
|---|---:|---:|---:|---:|---:|---|
| Qwen3 1.7B | 1,4 GB | 2,63 s | 3,45 s | ~17,5–20,2 tok/s | 3 | Puso limpiar escritorio antes de presentación de mañana; inventó «limbo» |
| Qwen3.5 2B | 2,7 GB | 4,95 s | 6,35 s | ~4,6–6,1 tok/s | 2 | Priorización incompleta; JSON sin `args` |
| Phi-4-mini 3.8B | 2,5 GB | 5,97 s | 7,21 s | ~9,0–9,3 tok/s | 2 | Describió una tool call pero no la emitió |
| Ministral 3 3B | 3,0 GB | 4,51 s | 5,61 s | ~11,9–14,2 tok/s | 2 | JSON eligió `add_task` en vez de `open_app`; inventó causas de cambio de hora |

La puntuación es una comprobación puntual, no un benchmark estadístico. `prioritize`: factura vence hoy, presentación mañana, limpiar escritorio sin vencimiento; orden esperado factura → presentación → escritorio. `strict_json`: `{"tool":"open_app","args":{"app":"Spotify"}}`. `tool_call`: invocación estructurada de `open_app`. `memory`: indicar solo que Ana pasó de las tres a las cuatro, sin inventar motivos. Ministral acertó priorización y llamada estructurada; Qwen3 1.7B acertó JSON, llamada y memoria, pero no priorización. Ninguno alcanza 4/4. Las respuestas y tiempos completos están en `llm-*.json` del directorio temporal indicado arriba (si persiste).

En la prueba directa de `llama-server` b11388 con Qwen3 1.7B cuantizado, carga ~3,44 s, llamada estructurada `open_app("Spotify")` correcta en 3,68 s; ~84,1 tok/s de prompt y 11,77 tok/s de generación, RSS observado ~2,07 GB. Deshabilitar el modo de razonamiento del template fue necesario; con él activado, un tope de 100 tokens produjo una respuesta vacía. Esto verifica una ruta Windows CPU específica, **no** paridad completa con Ollama ni Android/iOS. El servidor de PoC escuchó solo en localhost y fue detenido; el endpoint sin autenticación/CORS permisivo no es apto para producción.

**Candidato LLM provisional:** Qwen3 1.7B + llama.cpp, por latencia y acierto relativo en formatos/herramientas, no por capacidad de planificación autónoma. Requiere prompts más robustos, un evaluador de instrucciones en español, validación de esquema y permisos deterministas antes de cualquier control de equipo. [Qwen3 1.7B (Apache-2.0)](https://huggingface.co/Qwen/Qwen3-1.7B), [llama.cpp (MIT)](https://github.com/ggml-org/llama.cpp), [servidor y tool calls](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

## 5. STT y activación por voz

Se probó [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 1.13.8 con Whisper multilingüe int8 `tiny` y `base` en CPU, una muestra pública de voz humana española de 2,448 s y tres archivos sintéticos (dos Piper, uno Kokoro). La frase humana se interpretó como «Más vale pájaro en mano que cien volando»; no se suministró una transcripción oficial para calcular WER formal.

| Modelo | Archivos modelo | Carga | Voz humana 2,448 s | RTF humano | Observación |
|---|---:|---:|---:|---:|---|
| Whisper tiny multilingual int8 | 102,8 MB | 1,07 s | 0,376 s | 0,154 | Escribió «sien» por «cien»; confundió Gunter con «un ter»/«Gunther» |
| Whisper base multilingual int8 | 159,8 MB | 1,41 s | 0,630 s | 0,257 | Proverbio correcto; confundió Gunter en Piper y escribió «Guinter» en Kokoro |

`base` usó ~238 MB RSS tras carga y ~414 MB tras varias transcripciones. En los otros audios base tomó ~0,98–1,05 s para 4,8–7,4 s de audio, RTF ~0,14–0,20. Que RTF sea menor de 1 en este PC no prueba captura en vivo, VAD, interrupciones ni batería. La grabación personal del usuario está **pendiente de adjuntar** y es indispensable para comprobar acento, micrófono, ruido y órdenes reales. Para el nombre propio, se necesita prueba de vocabulario/normalización y un detector de activación separado; la transcripción general no es un wake-word confiable.

**Candidato STT provisional:** sherpa-onnx + Whisper base multilingüe int8; usar `tiny` solo como opción de hardware restringido si la precisión propia lo permite. Motor [Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE); pesos/atribuciones del modelo se deben verificar en el paquete final. [Modelos Whisper ONNX](https://k2-fsa.github.io/sherpa/onnx/spoken-language-identification/pretrained_models.html). `whisper.cpp` es alternativa MIT, pero no se ejecutó PoC aquí; `faster-whisper` queda especialmente como alternativa de escritorio, no como respuesta móvil demostrada.

Wake word: **pendiente**. [Sherpa-ONNX KWS](https://k2-fsa.github.io/sherpa/onnx/kws/index.html) ofrece motor abierto, pero no se probó un modelo español para «Hola Gunter», «Hi Gunter», «Gunter» y variantes. [openWakeWord](https://github.com/dscripka/openWakeWord) documenta modelos principalmente en inglés; [Porcupine](https://picovoice.ai/docs/quick-start/porcupine-python/) exige AccessKey, cuya disponibilidad/costo para cada usuario no cumple todavía el gate de costo esencial $0. Pulsar para hablar es el fallback de diseño exigible, no una afirmación de wake word completado. El uso permanente en segundo plano, especialmente iOS, necesita validación de políticas y dispositivos.

## 6. TTS: audio generado y comparación

Se generaron las mismas tres frases del encargo con [Piper es_MX-ald-medium](https://huggingface.co/rhasspy/piper-voices/blob/main/es/es_MX/ald/medium/MODEL_CARD) y [Kokoro v1.0 int8, voz `em_alex`](https://github.com/thewh1teagle/kokoro-onnx). WAV completos disponibles en el directorio temporal:

| Frase | Piper es-MX | Kokoro es-alex |
|---|---|---|
| «Hola, soy Gunter…» | `piper-es-mx-1.wav` | `kokoro-es-alex-1.wav` |
| «Perfecto. Dame un momento…» | `piper-es-mx-2.wav` | `kokoro-es-alex-2.wav` |
| «Buenos días. Hoy tienes…» | `piper-es-mx-3.wav` | `kokoro-es-alex-3.wav` |

| Motor | Archivos modelo | Carga | Síntesis frases 1/2/3 | Duración WAV 1/2/3 | RSS cargado → final |
|---|---:|---:|---:|---:|---:|
| Piper | 63,2 MB | 3,24 s | 0,684 / 0,557 / 0,380 s | 7,175 / 7,430 / 4,818 s | 134 → 245 MB |
| Kokoro int8 | 120,6 MB | 2,05 s | 9,308 / 9,817 / 7,693 s | 4,821 / 5,547 / 4,032 s | 182 → 336 MB |

Piper ganó en tiempo de archivo completo en este CPU. No se midió streaming ni tiempo al primer fonema. **Nadie escuchó y puntuó naturalidad/empatía en una evaluación humana**, por lo que no se puede declarar ganador de calidad. La voz Piper tuvo errores de inteligibilidad del nombre propio detectados por STT; esto no reemplaza escucharla. El motor Piper actual se declara [GPL-3.0-or-later en su paquete](https://github.com/OHF-Voice/piper1-gpl/blob/main/setup.py); el [modelo de voz tiene su propia ficha](https://huggingface.co/rhasspy/piper-voices/blob/main/es/es_MX/ald/medium/MODEL_CARD). Kokoro-onnx tiene licencia de código MIT y [pesos Kokoro Apache-2.0](https://huggingface.co/hexgrad/Kokoro-82M). La ruta española de ambos usa `espeak-ng`; el propio proyecto sherpa-onnx [advierte el problema de GPL en su paquete TTS](https://github.com/k2-fsa/sherpa-onnx/issues/3731). **Revisión legal de binarios, dependencias y voces distribuibles obligatoria antes de aprobar**. No afirmar que el código del wrapper MIT/Apache limpia toda la cadena.

**Candidato de latencia:** Piper, condicionado a licencia y escucha humana. **Candidato de naturalidad:** Kokoro, sin preferencia demostrada y demasiado lento aquí para respuesta inmediata. [Qwen3-TTS 0.6B](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice) y [Chatterbox Multilingual](https://github.com/resemble-ai/chatterbox) quedan sin PoC CPU/móvil. [Supertonic](https://github.com/supertone-oss-archive/supertonic) no se elige como base: el repositorio fue archivado y el soporte terminó; sus pesos además usan OpenRAIL-M.

## 7. Matriz de stack, plataformas, costo y licencia

| Capa | Candidato | Windows (probado) | Android | iOS | Web/PWA | Costo esencial | Estado |
|---|---|---|---|---|---|---|---|
| LLM | Qwen3 1.7B GGUF + llama.cpp | Sí, tool call directa | [Runtime documentado](https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md), sin PoC | XCFramework documentado, sin PoC | No browser offline integrado | $0 software; disco/energía locales | **Pendiente** calidad, seguridad, móvil |
| STT | sherpa-onnx + Whisper base int8 | Sí, archivos | SDK documentado, sin PoC | SDK documentado, sin PoC | WASM disponible, sin PoC de Gunter | $0 software | **Pendiente** voz propia y móvil |
| Wake | sherpa KWS/modelo a determinar | No | No | No | No | Por confirmar modelo | **Pendiente**; push-to-talk fallback |
| TTS | Piper es-MX | Sí | Empaquetado no probado | Empaquetado no probado | No demostrado | $0 ejecución local | **Pendiente por licencia y escucha** |
| TTS alterno | Kokoro int8 | Sí | No probado | No probado | No demostrado | $0 ejecución local | **Pendiente** latencia/licencia/naturalidad |
| Embeddings | [multilingual MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) ONNX | No PoC | No PoC | No PoC | No PoC | $0; Apache-2.0 | **Pendiente** recuperación en español |
| Shell PC | Electron (Node actual) | No PoC shell | N/A | N/A | Reutiliza UI | $0; MIT, costo de RAM | **Pendiente** empaquetado/seguridad |
| Shell móvil | App nativa existente + WebView restringida | N/A | Nodo Kotlin existe, UI WebView no | Nodo SwiftUI existe, WKWebView no | UI reutilizable | $0 herramientas salvo cuenta/distribución iOS | **Pendiente** dispositivos |
| Datos | SQLite local + adaptador | No PoC | No PoC | No PoC | IndexedDB actual | $0; dominio público | **Pendiente** migración/backup |
| Sincronización | Outbox versionada + backend existente | Sólo `settings.patch` actual | No PoC | No PoC | No PoC general | $0 self-host software; hosting no gratis garantizado | **Pendiente** conflictos e idempotencia |

`Ollama` (MIT) sirvió para comparar modelos en PC; no se selecciona como runtime único para móvil. [ExecuTorch](https://docs.pytorch.org/executorch/stable/llm/working-with-llms.html), [MLC LLM](https://llm.mlc.ai/docs/compilation/compile_models.html) y [ONNX Runtime GenAI](https://onnxruntime.ai/docs/genai/) son rutas multiplataforma razonables, pero conversiones/artefactos específicos y ausencia de PoC impiden preferirlas. [Tauri sidecars](https://v2.tauri.app/develop/sidecar/) es alternativa de shell; requiere empaquetado Rust/sidecars adicional sobre la base Node existente. Electron reduce cambio arquitectónico, pero todavía debe demostrar RAM, aislamiento y permisos del proceso principal. [Android WebView bridge](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges) exige origen allowlist y APIs mínimas. En iOS deben probarse [WKWebView](https://developer.apple.com/documentation/webkit/wkwebview/), permisos y restricciones de ejecución en segundo plano.

La comparación documental también incluyó [SmolLM3 3B](https://huggingface.co/HuggingFaceTB/SmolLM3-3B) y [Gemma 3 4B](https://huggingface.co/google/gemma-3-4b-it), además de los cuatro LLM medidos. SmolLM3 tiene tamaño/contexto atractivos, pero no se ejecutó con la plantilla final ni tool calling de Gunter; Gemma impone términos propios y tampoco se probó. No se infiere que sus resultados sean inferiores: son **PENDING**, no perdedores medidos. Para un perfil `LITE`, Qwen3 1.7B es el único modelo pequeño medido aquí; su calidad insuficiente obliga a limitarlo a sugerencias/lectura. No se asignan modelos `BALANCED`/`POWER` para móvil sin memoria y batería medidas. En PC potente se puede reabrir la comparación 3–8B si una suite funcional muestra ganancia real.

Las tres combinaciones prioritarias de investigación fueron Qwen3 1.7B + llama.cpp (prueba directa), Ministral 3 3B + runtime local (Ollama como banco CPU, no validación llama.cpp/móvil) y Phi-4-mini 3.8B + runtime local (Ollama como banco CPU). Qwen3.5 2B se añadió como control reciente. **No se probaron tres runtimes diferentes**: hacerlo habría confundido resultados de conversión, cuantización y plantilla sin artefactos equivalentes. [Ministral 3 3B (Apache-2.0)](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512), [Phi-4-mini (MIT)](https://huggingface.co/microsoft/Phi-4-mini-instruct), [Qwen3.5 2B (Apache-2.0)](https://huggingface.co/Qwen/Qwen3.5-2B).

**Voicebox como referencia:** su [arquitectura oficial](https://docs.voicebox.sh/developer/architecture) combina React/Tauri, sidecar Python/FastAPI, SQLite y registro/cola de modelos; los modelos/proveedores documentados incluyen Qwen3-TTS, Kokoro y Chatterbox para voz y Whisper para transcripción. La separación UI/proveedor, versionado de modelos, cola y caché son ideas útiles. No hay benchmark independiente, medición de CPU español o justificación de selección de modelos trasladable directamente a Gunter; tampoco conviene introducir Python/FastAPI/Tauri completos sobre el servidor Node y nodos existentes. Su licencia y la de cada backend/peso deben auditarse por separado si se reutilizara código. Se trató como **referencia técnica, no dependencia ni ganador**.

**Shell móvil:** [Capacitor con plugins Kotlin](https://capacitorjs.com/docs/android/custom-code) ofrece empaquetado WebView y puente estandarizado; el WebView nativo existente/planificado con bridge Kotlin restringido reutiliza `GunterNodeService`, `MobileExecutors` y `SecureNodeStore` sin migrar la app Android. Se prefiere ensayar la segunda ruta porque hay código Kotlin específico y no se justificó añadir Capacitor; no está aprobada. En iOS se propone conservar SwiftUI y añadir `WKWebView`/`WKScriptMessageHandler` mínimo para UI, con motores nativos como servicios separados. Ninguna de las dos rutas se ha compilado/probado con los modelos en dispositivos.

La propuesta de almacenamiento es **SQLite local por host nativo** y mantener IndexedDB para PWA, con IDs estables y una outbox de mutaciones. [SQLite es de dominio público](https://www.sqlite.org/copyright.html); [PostgreSQL](https://www.postgresql.org/about/licence/) puede ser backend remoto autohospedado, pero servidor, dominio, energía, copias y mantenimiento no son costo $0 universal. No se eligió servicio cloud obligatorio. La sincronización debe conservar author/device ID, versión, idempotency key, tombstones, reintentos con backoff, resolución visible de conflictos y cifrado/credenciales por plataforma. **No reejecutar automáticamente acciones externas irreversibles** al reconectar. Aún no hay PoC de migración ni de conflictos; no aprobar.

### Puntuación orientativa de finalistas

Escala 1–5, donde 5 es más favorable para Gunter; `?` significa evidencia insuficiente. No es una clasificación automática ni una equivalencia de calidad. Los números combinan PoC de Windows, arquitectura actual y fuentes oficiales; licencias se refieren a la cadena conocida y conservan gate legal.

| Opción | Calidad | Madurez | Mantenimiento | Comunidad | Docs | Multiplataforma | Rendimiento | Licencia | Integración | Costo | Justificación principal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Qwen3 1.7B + llama.cpp | 2 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 3 | 5 | 3/4 mini-casos; tool call directa, rápida; móvil no probado |
| Ministral 3 3B + Ollama (banco) | 2 | 4 | 4 | 4 | 4 | 1 | 3 | 4 | 3 | 5 | 2/4; Ollama no resuelve runtime móvil |
| Phi-4-mini + Ollama (banco) | 2 | 4 | 4 | 4 | 4 | 1 | 2 | 4 | 3 | 5 | 2/4; no emitió llamada estructurada |
| sherpa-onnx + Whisper base | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 5 | Proverbio bien, nombre Gunter falla; atribuciones por cerrar |
| Piper es-MX | ? | 4 | 3 | 4 | 4 | 3 | 5 | 1 | 3 | 5 | Síntesis rápida; escucha pendiente y GPL/espeak |
| Kokoro int8 español | ? | 3 | 3 | 3 | 3 | 2 | 1 | 2 | 3 | 5 | Síntesis CPU lenta; modelo/wrapper permisivos, g2p por revisar |

La calidad LLM no se extrapola de cuatro preguntas. La calidad TTS queda `?` porque naturalidad es perceptual; STT 3/5 solo refleja el lote pequeño. Mantenimiento/comunidad son aproximaciones del ecosistema oficial, no una auditoría cuantitativa de commits o issues; antes de fijar versiones deben revisarse releases y regresiones.

### Costos y cadena de licencias

| Componente | Clase | Código/runtime | Pesos/voz | Redistribución/uso comercial |
|---|---|---|---|---|
| Qwen3 1.7B + llama.cpp | FREE_LOCAL_MODEL | MIT llama.cpp | Apache-2.0 Qwen3 | Permitido sujeto a avisos; validar GGUF derivado |
| Ministral 3 3B + Ollama | FREE_LOCAL_MODEL | MIT Ollama | Apache-2.0 Ministral 3 | Validar modelo empaquetado/avisos |
| Phi-4-mini + Ollama | FREE_LOCAL_MODEL | MIT Ollama | MIT Phi-4-mini | Validar modelo empaquetado/avisos |
| sherpa-onnx + Whisper | FREE_LOCAL_MODEL | Apache-2.0 sherpa | MIT Whisper; export ONNX a revisar | LICENSE_REVIEW_REQUIRED para paquete final |
| Piper es-MX | FREE_LOCAL_MODEL | GPL-3.0 motor actual; espeak-ng | ficha específica de voz | **LICENSE_REVIEW_REQUIRED** (modo de enlace/redistribución) |
| Kokoro int8 | FREE_LOCAL_MODEL | MIT wrapper; espeak-ng | Apache-2.0 modelo | **LICENSE_REVIEW_REQUIRED** por cadena española |
| Wake sherpa KWS | FREE_OPEN_SOURCE (motor) | Apache-2.0 | modelo «Gunter» no elegido | PENDING modelo/licencia/costo real |
| SQLite / IndexedDB | FREE_OPEN_SOURCE / API web | SQLite dominio público; IndexedDB nativo navegador | N/A | Driver/cifrado por plataforma PENDING |
| PostgreSQL propio | FREE_OPEN_SOURCE | Licencia PostgreSQL | N/A | Software libre, infraestructura no gratuita universal |
| Porcupine | costo no demostrado; potencial PAID_REQUIRED | licencia/AccessKey propios | wake personalizado | Excluido de ruta esencial hasta demostrar $0 por usuario |
| Cloud opcional | OPTIONAL_FREE_TIER o PAID_OPTIONAL | según proveedor | según proveedor | Nunca requisito para la capacidad offline |

### Matriz final de selección (candidato no significa aprobación)

| Componente | Ganador provisional | Segundo | Evidencia | PoC | Licencia | Costo | Estado |
|---|---|---|---|---|---|---|---|
| LLM model | Qwen3 1.7B | Ministral 3 3B | 3/4 frente a 2/4, menor latencia | Windows CPU | Apache-2.0 / Apache-2.0 | FREE_LOCAL_MODEL | PENDING calidad/seguridad |
| LLM runtime | llama.cpp | ExecuTorch | Tool call directa; SDK móvil documentado | Windows CPU solo | MIT / BSD-style PyTorch | FREE_OPEN_SOURCE | PENDING móvil |
| STT | sherpa-onnx + Whisper base | whisper.cpp | RTF 0,257 humano; SDK móvil | Windows archivos | Apache-2.0 + MIT, export pendiente | FREE_LOCAL_MODEL | PENDING voz/dispositivo |
| TTS desktop | Piper es-MX | Kokoro int8 | 0,38–0,68 s vs 7,69–9,82 s/archivo | Windows CPU | GPL-3.0/espeak/voz a revisar | FREE_LOCAL_MODEL | LICENSE_REVIEW_REQUIRED |
| TTS mobile | Piper es-MX a evaluar | Kokoro o TTS nativo accesible | Solo tamaño/CPU PC | No | Igual que arriba | FREE_LOCAL_MODEL | PENDING dispositivo/licencia |
| Wake word | sherpa KWS a entrenar/evaluar | push-to-talk (fallback) | Motor abierto; sin modelo «Gunter» | No | Apache-2.0; modelo pendiente | FREE_OPEN_SOURCE tentativo | PENDING |
| Embeddings | multilingual MiniLM-L12-v2 ONNX | Qwen3-Embedding 0.6B | 50 idiomas/100M y ORT reutilizable con STT | No | Apache-2.0 / Apache-2.0 | FREE_LOCAL_MODEL | PENDING calidad/runtime |
| Windows shell | Electron + Node actual | Tauri sidecar | Ajuste a CommonJS/PowerShell existente | No | MIT / MIT+Apache-2.0 | FREE_OPEN_SOURCE | PENDING empaquetado |
| Android shell | Kotlin actual + WebView bridge mínimo | Capacitor + plugins Kotlin | Reutiliza servicios nativos | No | SDK Android; deps a revisar | FREE_OPEN_SOURCE | PENDING dispositivo |
| iOS | SwiftUI actual + WKWebView bridge mínimo | shell Capacitor | Reutiliza host Swift | No | SDK Apple; deps a revisar | SDK gratis; distribución puede costar | PENDING Mac/dispositivo |
| Local DB | SQLite nativo; IndexedDB web | IndexedDB en shell | Encaje con datos offline/backup | No | Dominio público/API web | FREE_OPEN_SOURCE | PENDING migración |
| Remote DB | PostgreSQL autohospedado opcional | backend actual sin cambio | Sin obligatoriedad cloud | No | PostgreSQL | software libre; hosting variable | PENDING costo/operación |
| Sync architecture | outbox versionada + idempotencia | backup/manual export | Evita duplicados/replay | No | diseño propio | FREE_OPEN_SOURCE (software) | PENDING pruebas |

### Una arquitectura principal para las siguientes PoC, no para producción

```text
LLM MODEL: Qwen3 1.7B cuantizado; limitado a sugerencias hasta pasar suite funcional/seguridad.
LLM RUNTIME: llama.cpp detrás de un adaptador, evaluado solo en Windows.
STT: sherpa-onnx + Whisper base multilingüe int8; activación separada.
TTS WINDOWS: Piper es-MX condicional a licencia y escucha; Kokoro como comparación de calidad.
TTS ANDROID: Piper es-MX como primera PoC de eficiencia, sin elección aprobada.
TTS IOS: Piper es-MX como primera PoC; sin elección aprobada hasta iPhone real.
WAKE WORD: sherpa KWS por investigar para «Gunter»; push-to-talk obligatorio.
EMBEDDINGS: multilingual MiniLM-L12-v2 ONNX a probar, aprovechando ORT del STT si es viable.
WINDOWS: Electron sobre Node/CommonJS existente como primera PoC de shell.
ANDROID: Kotlin existente + WebView y puente allowlist mínimo como primera PoC.
IOS: SwiftUI existente + WKWebView y puente mínimo como primera PoC.
LOCAL DATABASE: SQLite en hosts nativos, IndexedDB en PWA, mediante interfaz común.
REMOTE DATABASE: PostgreSQL opcional/autohospedado tras medir operación; nunca requisito offline.
SYNC: outbox versionada/idempotente, conflictos visibles, sin replay de acciones externas.
```

## 8. Qué se descarta o se pospone

| Opción | Decisión y motivo | Condición de reconsideración |
|---|---|---|
| Supertonic como TTS base | Descartado por archivo/fin de soporte y licencia de pesos distinta a Apache/MIT | Mantenimiento activo verificable y licencia compatible |
| SenseVoice para STT español | Descartado para español; [idiomas soportados](https://github.com/k2-fsa/sherpa/blob/master/docs/source/onnx/sense-voice/pretrained.rst) no incluyen español | Modelo nuevo oficial con español y PoC |
| Ministral-8B-Instruct-2410 | Descartado por [licencia de investigación](https://huggingface.co/mistralai/Ministral-8B-Instruct-2410) y tamaño; distinto de Ministral 3 3B Apache-2.0 | Licencia comercial clara y necesidad de calidad demostrada |
| Gemma 3 4B | Pospuesto por términos propios y mayor huella; no se probó | Revisión legal + ventaja funcional medida |
| Porcupine | No base $0 garantizada por clave y términos de uso | Contrato de costo/uso aceptable para todos los usuarios |
| Cloud-only LLM/STT/TTS | Descartado como ruta **esencial offline**; puede seguir como proveedor opcional online | Nunca reemplazar fallback local para promesa offline |
| «Control total» autónomo del PC | No aprobado: las cuatro PoC LLM cometen errores | Tests de riesgo/permiso, confirmación, sandbox, trazabilidad y 0 fallos críticos |

## 9. Gates pendientes y pruebas de aceptación

1. **Voz real del usuario:** grabación española 10–20 s con «Hola/Hi Gunter» y orden. Medir transcripción, falsas activaciones, ruido, acento, interrupción, VAD y naturalidad percibida de los seis WAV.
2. **LLM:** suite de al menos 100 casos españoles: selección de herramienta, argumentos, negativa honesta, planificación con fechas/zonas reales, memoria, ambigüedad, prompt injection, comandos peligrosos y vuelta atrás. Exigir 0 acciones no autorizadas; selección de herramienta validada por esquema, allowlist y confirmación de impactos. Correr comparación directa en runtime final y con prompts idénticos.
3. **Desktop:** PoC de shell/sidecar con firma, sandbox/preload, recursos locales, reinicio tras fallo, aislamiento entre usuarios, instalación/desinstalación, respaldo y rollback. Medir RAM total en reposo y bajo carga, no solo proceso de inferencia.
4. **Android físico:** al menos dispositivo bajo/medio, offline real, instalación de modelo, RAM/temperatura/batería, wake/STT/TTS bajo permisos y suspensión, interrupciones, push-to-talk, WebView bridge y recuperación tras cierre. No se dispone de dispositivo conectado ahora.
5. **iOS físico:** macOS/Xcode, iPhone real, tamaño y firma, memoria/batería, WKWebView/Swift bridge, restricciones de micrófono/background y permisos. Imposible certificar desde este Windows.
6. **Datos/sync:** migración reversible de IndexedDB/localStorage, backup cifrado/restauración, dos dispositivos editando sin conexión, conflictos/tombstones, idempotencia, reconexión y no replay de acciones; consentimiento para sincronizar conversaciones.
7. **Licencias:** revisar código + modelos + voces + tokenizador + espeak + atribuciones; confirmar redistribución y uso comercial por plataforma, no solo licencia del repositorio raíz.
8. **Regresión:** baseline actual `npm run test:assistant` 50/50, `npm run test:control` 33/33, `npm run test:mobile` 4/4 en este equipo. Repetir con adaptadores y ejecutar E2E con servicios locales/online en cada shell. Las pruebas actuales no validan el stack offline.

## 10. Dictamen

La ruta de investigación inicial para **Windows CPU** fue Qwen3 1.7B/llama.cpp, sherpa-onnx/Whisper base y Piper o Kokoro tras revisión de voz/licencias, con push-to-talk hasta probar wake word. La suite ampliada y la PoC KWS de la siguiente sección corrigen esa preferencia: no se debe presentar Qwen como planificador autónomo ni prometer wake word con el modelo probado. SQLite local + sincronización versionada es arquitectura a validar, no infraestructura ya integrada. **No se aprueba instalación en producción ni se promete control total, voz siempre activa, funcionamiento offline completo o paridad móvil.**

## 11. Cierre de gates de la fase 2 (actualiza resultados y preferencias anteriores)

### Aislamiento y artefactos reproducibles

Las fuentes, modelos, resultados JSON, datos ficticios y WAV persistentes están en `gunter-validation-poc/` (directorio hermano local, fuera del código productivo). `README.md` identifica el aislamiento. Los scripts relevantes son `llm-gates.mjs`, `tool-schema-gates.mjs`, `stt-gunter-gates.py`, `wake-gates.py`, `qwen-tts-gates.py`, `electron-poc/`, `android-poc/`, `data-gates.mjs` y `sync-gates.mjs`. No hay adaptador de acciones reales en las PoC. No se tocaron `/api/chat`, `/api/tts`, `/api/transcribe`, memorias ni shells productivos. Las muestras personales solicitadas al usuario no llegaron durante esta prueba.

### LLM: 120 casos españoles y barrera de acciones

Suite determinista `llm-gates.mjs`: 12 familias × 10 variaciones (conversación, contexto/memoria, fecha/hora, prioridades e instrucciones contradictorias, ambigüedad, extracción JSON, navegación/herramientas, ajustes/argumentos, información inexistente, acciones sensibles/confirmación, inyección y recuperación). Contrato fijo `intent/tool/args/answer`, temperatura 0, contexto 4096, `think:false`, máximo 120 tokens. Los casos repiten plantillas con variaciones; **no son 120 preguntas independientes del mundo real**. Se ejecutaron en Ollama CPU; la prueba previa de llama.cpp directa fue mucho menor, por lo que la puntuación no certifica aún llama.cpp como runtime final.

| Modelo/configuración | Exactos | JSON/esquema | Selección de herramienta | Latencia media | Primera salida media | Generación media | RAM modelo residente reportada por Ollama |
|---|---:|---:|---:|---:|---:|---:|---:|
| Qwen3 1.7B, prompt inicial (36, solo referencia) | 0/36 | 0/36 | no comparable | 2,46 s | 0,78 s | 23,3 tok/s | no guardada |
| Qwen3 1.7B, sistema + JSON Schema v1 | 32/120 | 120/120 | 109/120 | 3,41 s | 0,73 s | 20,6 tok/s | ~1,9 GB |
| Qwen3 1.7B, sistema/few-shot + JSON Schema v2 | **83/120** | **120/120** | 98/120 | 2,70 s | 0,82 s | 19,5 tok/s | ~1,9 GB |
| Ministral 3 3B, misma v2 | **105/120** | **115/120** | 115/120 | 7,63 s | 1,51 s | 8,6 tok/s | ~2,7 GB |

El 0/36 inicial se debió a que el prompt débil no indujo el esquema requerido y no debe interpretarse como incapacidad general. La versión v2 mejora a Qwen sin entrenarlo; los fallos restantes son relevantes: prioridades 0/10, ambigüedad 0/10 y recuperación 0/10 bajo este contrato. Ministral resolvió prioridades 10/10 y ambigüedad 9/10, pero conversación 0/10 (rechazos excesivamente cautos frente al contrato de ayuda), recuperación 6/10 y produjo cinco salidas de esquema inválido. «Exacto» exige la salida contractual esperada, no una evaluación humana de utilidad. El campo `args` tiene numerosos casos sin argumentos y su 120/120 de Qwen no prueba extracción universal. En las diez preguntas de información no disponible por modelo no se observó una afirmación factual inventada; Qwen obtuvo 9/10 exactos porque una negativa honesta no coincidió literalmente con el patrón estricto (tilde en «cuándo»), Ministral 10/10. Esto no estima una tasa general de alucinación ni autoriza afirmar conocimiento total.

PoC adicional con **tool schema nativo**, 25 órdenes/modelo: Qwen 25/25 coincidencias de propuesta (incluidas cinco propuestas de `send_message` sin confirmación que la barrera siempre bloqueó); Ministral 19/25 estrictas: 14/15 acciones de bajo impacto correctas, 5/5 negativas a invocar el envío no confirmado y 5/5 negativas a inventar archivos. La barrera determinista valida esquema, allowlist, objetivo/argumentos, tipo de operación y confirmación **independiente**. `send_message` carece de token en la PoC y se bloquea siempre; 0/240 y 0/50 acciones no autorizadas fueron **ejecutadas** en ambas suites. Este 0 es propiedad de la barrera simulada, no garantía de que el modelo no proponga acciones erróneas. No se conectaron programas, archivos ni redes sociales. Para chat, resumen y sugerencias de lectura, ambos modelos son candidatos; para ordenar o ejecutar, requieren reglas, permisos, confirmación y más pruebas. Las acciones sensibles no se delegan a una decisión textual del LLM; si una tarea supera el modelo local, un proveedor cloud solo podrá ser opcional y bajo las mismas reglas.

### STT y wake word: resultado negativo para «Gunter»

Whisper base multilingüe int8 en sherpa-onnx transcribió 36 audios **sintéticos**: 4 expresiones × 3 voces (Piper es-MX, Kokoro español masculina/femenina) × audio limpio, ruido blanco SNR 20 y 10 dB. Detectó el nombre literal en **3/36**; normalizar solo `Gunther`/`Guinter` como vocativo inicial con `Hola`/`Hi`/`Oye` elevó a **4/36**. Por expresión: `Gunter` 0→1/9; `Hola Gunter` 0/9; `Hi Gunter` 0/9; `Oye Gunter` 3/9. No se normalizan fragmentos como «un ter», otros nombres en medio de una conversación ni semejanzas fonéticas genéricas. `OfflineRecognizer.from_whisper` en la versión instalada no expone hotword/context prompt para este modelo. Esto **no resuelve el nombre**. Sin audio humano del usuario no se puede medir acento/micrófono/WER real. STT general y detector de activación son gates diferentes.

La PoC aislada de sherpa-onnx KWS usó el modelo GigaSpeech 3.3M int8 **entrenado para inglés** con tokens de `Gunter`, `Hola Gunter`, `Hi Gunter` y `Oye Gunter`, umbral 0,25. Resultado: **0/12 verdaderos positivos**, 0/4 falsos positivos en negativos pequeños; 30 s repetidos de una muestra humana pública se procesaron en 0,895 s sin disparo, pero no miden falsos positivos por hora ni escucha real sostenida. Pesos KWS 5,25 MB; carga 1,4 s; RSS 36,4→80,2 MB, ~90 MB al final. Modelo inglés + voces sintéticas impiden extrapolar al uso español. No se encontró en esta fase un modelo gratuito probado y apto para el vocativo español; un modelo propio requeriría corpus humano, negativos, entrenamiento, umbrales y pruebas continuas en dispositivos. **No aprobar wake word; mantener pulsar-para-hablar.**

### Datos, backup y sincronización: pruebas con datos falsos

`data-gates.mjs` define un contrato `DataRepository` con operaciones y control de propietario; SQLite se implementó solo para el host de prueba, manteniendo IndexedDB como adaptación web futura. **12/12** checks pasan: CRUD de seis categorías, versiones/tombstones, transacción, rollback por excepción y salida abrupta de proceso hijo, migración v1→v2, WAL/integridad, backup SQLite, SHA-256 y restauración completa. Backup de 12.288 bytes en 8 ms en el equipo; incluye configuración, memoria, conversación, tarea, evento y metadatos ficticios. La PoC es plaintext: no demuestra cifrado, migración desde stores reales, aislamiento criptográfico entre usuarios ni rollback productivo.

`sync-gates.mjs`: **9/9** checks con dos dispositivos simulados A/B offline, `operationId`, `idempotencyKey`, versión, tombstone, conflicto visible/resolución manual, red intermitente, caída después de confirmar en servidor y reintento duplicado. La clave de operación fue corregida para mantener secuencia persistente después de limpiar la cola. Outbox acepta solo mutaciones de **estado**; envío de mensajes, borrado de archivo y comandos externos se rechazan incluso si llegan por inyección al servidor simulado. No se probó backend real, criptografía, múltiples usuarios reales ni dispositivos físicos; no autoriza migración ni sincronización de conversaciones privadas.

### Shells aislados

Electron 44.5.1 + Node 24: `npm run electron:smoke` pasó inicio/cierre, helper Node ligado a `127.0.0.1` en puerto efímero, UI HTML/CSS/JS de prueba, preload/contextBridge, IPC con origen permitido, `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true`, bloqueo de navegación/ventanas externas y reinicio de helper tras fallo. Working sets sumados de procesos Electron: ~62,8 MB al inicio y **292,3 MB con UI**; tras reinicio 303,7 MB. Concurrentemente había dos procesos Ollama residentes de ~3.020 y 1.896 MB RSS; el shell no los incluye. Las sumas RSS pueden contar páginas compartidas dos veces. **No** se cargó la UI completa de Gunter, ni se empaquetó/firmó/instaló ni se midió el comportamiento de multisesión; Tauri no se compara porque no apareció un bloqueo arquitectónico que lo justifique.

Android: código separado con `applicationId` propio, `WebViewAssetLoader` de origen local HTTPS, `WebViewCompat.addWebMessageListener` con origen permitido y solo marco principal, validación de identificador/tamaño/acción, únicamente consulta read-only `status`, `allowFileAccess`/`allowContentAccess` desactivados y bloqueo de navegación externa; sin exponer objetos nativos genéricos. `adb devices` no encontró teléfono. Intentos de Gradle/JDK 19 y JBR21 fallaron **antes de compilar** con `Unable to establish loopback connection` de Java NIO; la dependencia AndroidX WebKit tampoco está precargada para build offline. Por tanto, la PoC Android **no tiene build ni prueba física válidos**. iOS no se modificó ni probó: hace falta Mac/Xcode y iPhone real. No se atribuyen capacidades móviles no medidas.

### Licencias y distribución comercial: revisión obligatoria

| Ruta | Código/paquete | Pesos/voz y cadena | Decisión de licencia |
|---|---|---|---|
| Piper `piper-tts` actual | [Piper 1 GPL-3.0-or-later y dependencia espeak-ng](https://github.com/OHF-Voice/piper1-gpl/blob/main/setup.py) | [Repositorio de voces MIT y ficha `es_MX-ald-medium`](https://huggingface.co/rhasspy/piper-voices/blob/main/es/es_MX/ald/medium/MODEL_CARD); dataset declarado Unlicense; voz afinada desde `es_ES-davefx-medium`, cuya [ficha](https://huggingface.co/rhasspy/piper-voices/blob/main/es/es_ES/davefx/medium/MODEL_CARD) declara CC0 y otra cadena de afinado | `LICENSE_REVIEW_REQUIRED`: el MIT del repositorio de voces no elimina la GPL del binario/phonemizer ni sustituye revisión de linaje/avisos |
| `espeak-ng` | [GPLv3](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING) | Datos de pronunciación distribuidos con el motor; confirmar atribuciones del paquete final | `LICENSE_REVIEW_REQUIRED` para empaquetado de Piper/Kokoro en una app comercial |
| Kokoro español vía `kokoro-onnx` | [Wrapper MIT](https://github.com/thewh1teagle/kokoro-onnx/blob/main/LICENSE) | [Pesos Kokoro-82M Apache-2.0](https://huggingface.co/hexgrad/Kokoro-82M), voces `em_alex`/`ef_dora` documentadas en [VOICES.md](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md); cadena española usa `espeak-ng` y `phonemizer` [GPL](https://github.com/bootphon/phonemizer/blob/master/LICENSE) | `LICENSE_REVIEW_REQUIRED` para ruta española completa, obligaciones GPL y notices Apache/MIT |
| Qwen3-TTS 0.6B CustomVoice | [Código Apache-2.0](https://github.com/QwenLM/Qwen3-TTS/blob/main/LICENSE) | [Pesos/model card Apache-2.0](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice); timbres incorporados, speaker `Ryan` en prueba; dependencias PyTorch/Transformers/tokenizador a inventariar | `LICENSE_REVIEW_REQUIRED` para paquete comercial completo y avisos, aunque código/pesos principales sean permisivos |

«Uso comercial» no queda prohibido automáticamente por GPL, pero el modo de distribución, enlace, código fuente correspondiente y avisos requieren asesoría jurídica. No confundir servicio remoto, descarga de pesos por usuario y binario empaquetado. No afirmar compatibilidad jurídica por inferencia del nombre de una licencia.

### Matriz de decisión de componentes

`APPROVED` se reserva a candidato con gate funcional, legal, seguridad y regresión suficientes para iniciar integración. `APPROVED_PENDING_DEVICE_TEST` permite avanzar solo si **únicamente** falta dispositivo físico. Las PoC que pasaron pruebas ficticias no equivalen a migración aprobada.

| Componente | Estado | Razón pendiente o rechazo |
|---|---|---|
| LLM | PENDING | Qwen 83/120, Ministral 105/120; errores de esquema/planificación y prueba de conversación; solo candidatos para chat/sugerencias |
| LLM runtime | PENDING | Suite completa en Ollama, no en llama.cpp; falta contrato/permisos bajo runtime final |
| STT | PENDING | Nombre Gunter 4/36 tras normalización; voz humana real ausente |
| Wake word (KWS inglés probado) | REJECTED | 0/12 activaciones sintéticas; no apto para este vocativo español |
| TTS desktop | PENDING | Comparación perceptual y licencia sin cerrar; Qwen3-TTS CPU se detalla abajo |
| TTS mobile | PENDING | Sin dispositivo, memoria/batería/paquete/licencia |
| Embeddings | PENDING | No fue gate de esta fase; falta calidad, runtime y privacidad |
| Windows shell | PENDING | PoC mínima pasa, pero no UI real/paquete/firma/instalación/rollback |
| Android shell | PENDING | Fuente aislada creada; build bloqueado, sin dispositivo |
| iOS shell | PENDING | Sin Mac/Xcode/iPhone ni PoC nativa |
| Local DB | PENDING | 12/12 con datos ficticios; faltan migración real, cifrado y contratos host/web |
| Backup | PENDING | SHA-256/restauración ficticia pasa; faltan cifrado, permisos y restauración de datos reales |
| Sync | PENDING | 9/9 simulado; sin backend real ni múltiples usuarios/dispositivos |

No hay componente nuevo `APPROVED` ni `APPROVED_PENDING_DEVICE_TEST` bajo la Regla 0. Es un resultado deliberadamente conservador: **0 acciones no autorizadas en una simulación y una PoC de integración no prueban la seguridad o la paridad de toda la aplicación**. La alternativa de pulsar-para-hablar sigue disponible sin depender del KWS rechazado.

### TTS CPU adicional y muestras persistentes

Las nueve muestras WAV de tres frases idénticas están en `gunter-validation-poc/samples/tts/` (directorio hermano local): `piper-es-mx-{1,2,3}.wav`, `kokoro-es-alex-{1,2,3}.wav` y `qwen3-tts-0.6b-ryan-{1,2,3}.wav`. Las seis primeras se copiaron desde TEMP y sus archivos persisten fuera del producto; las tres últimas se generaron allí. Los índices corresponden, respectivamente, a «Hola, soy Gunter…», «Perfecto. Dame un momento…» y «Buenos días. Hoy tienes…». Nadie ha puntuado naturalidad/empatía ni inteligibilidad percibida; el usuario debe escucharlas con auriculares, idealmente sin conocer el motor, y comparar nombre, acento español, pausas, calidez y claridad. **No declarar ganador perceptual por velocidad.**

| Motor/voz | Carga CPU | Frases 1 / 2 / 3: archivo completo | Pesos | RSS cargado → final | Primera emisión | CPU |
|---|---:|---:|---:|---:|---|---|
| Piper es-MX ald | 3,240 s | 0,684 / 0,557 / 0,380 s | 63,2 MB | 134 → 245 MB | no instrumentada | no instrumentado en fase 1 |
| Kokoro int8 es-alex | 2,054 s | 9,308 / 9,817 / 7,693 s | 120,6 MB | 182 → 336 MB | no instrumentada | no instrumentado en fase 1 |
| Qwen3-TTS 0.6B CustomVoice/Ryan, PyTorch eager CPU | 3,845 s tras liberar otros modelos | **77,315 / 99,511 / 60,110 s** | 2.493,9 MB | 3.973 → 5.298 MB | no disponible con llamada no streaming | muestreo 5 s durante síntesis: ~391 % de un núcleo (≈3,9 núcleos), no promedio de todas las frases |

Qwen3-TTS falló inicialmente al cargar con error Windows 1455 (memoria virtual insuficiente) mientras dos modelos Ollama estaban residentes. Tras descargarlos de RAM, cargó y generó los tres WAV. La calidad auditiva no se verificó, y `Ryan` no se presenta como timbre nativo hispanohablante. La ausencia de SoX produjo una advertencia no fatal en la ruta CustomVoice; `flash-attn` no estuvo instalado y se usó PyTorch eager. En este hardware CPU, Qwen3-TTS no cumple una respuesta de voz interactiva; podría reconsiderarse con hardware/quantización/streaming medidos, pero no es elección desktop ni móvil actual. Los números de memoria son RSS de procesos y no equivalen a consumo compartido real del sistema.

### Regresión tras las PoC

En el checkout compartido y sin sustituir el stack productivo: `npm run test:assistant` **50/50**, `test:control` **33/33**, `test:mobile` **4/4**; además `test:node` **12/12**, `test:jobs` **5/5**, `test:auth`, `test:ui`, `test:preflight`, `test:api-base`, `test:mobile-push` pasaron. `test:smoke` **139/139** sobre servidor/datos desechables; `test:e2e` **1/1** recorrió alta/tarea/configuración/viewport móvil en servidor aislado (~40 s). Estos tests confirman ausencia de regresión observable en sus contratos, **no** certifican los motores offline ni todas las funciones de Gunter en dispositivos reales. El checkout ya contenía cambios de trabajo ajenos a esta fase; esta validación solo editó estos dos documentos dentro de `gunter-app` y mantuvo todas las PoC fuera.
