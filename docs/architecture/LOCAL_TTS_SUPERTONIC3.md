# Gunter Local TTS — Supertonic 3 M1

## Estado y alcance

- Voz masculina M1 en español, aprobada perceptualmente por el usuario.
- Runtime Windows: Node.js + `onnxruntime-node@1.17.3`, CPU, cuatro hilos intra-op. El usuario final **no necesita Python**; el trabajador de producción es `server/local-tts-worker.js`.
- Estado máximo tras pasar los gates de esta fase: `APPROVED_FOR_WINDOWS_LOCAL_TTS`. No equivale a aprobación multiplataforma ni a autorización comercial completa.
- Los ONNX y la voz M1 se conservan fuera de Git; no se descargan durante inferencia.

## Cadena y contrato

```text
VoiceService (js/services/voice-service.js)
  → GunterTTS (/api/tts)
  → TTSRouter (server/control-plane/model-router.js)
  → SupertonicProvider (server/local-tts.js)
  → PlatformRuntime (server/local-tts-worker.js → server/local-tts-onnx.js)
```

El runtime implementa `start()`, `health()`, `synthesize()`, `cancel()` y `stop()`. El servidor conserva un trabajador aislado con el modelo cargado; abortar una petición termina ese trabajador y la siguiente petición lo reinicia. La lógica del asistente no invoca ONNX ni conoce la plataforma. El navegador divide respuestas largas y prepara el siguiente fragmento durante la reproducción. El botón **Hablar** detiene la voz antes de iniciar la grabación Moonshine.

`AUTO` usa local si está instalado y `tts.local` está activado. `CLOUD` conserva el proveedor anterior. `LOCAL` y `LOCAL_ONLY` no hacen fallback silencioso a nube ni a `speechSynthesis`; devuelven error explícito. La bandera `tts.local` está **OFF por defecto** en una instalación nueva.

## Assets reproducibles

- Repositorio del modelo: [`Supertone/supertonic-3`](https://huggingface.co/Supertone/supertonic-3).
- Revisión exacta: `724fb5abbf5502583fb520898d45929e62f02c0b`.
- Voz: `M1.json`; ONNX: `duration_predictor`, `text_encoder`, `vector_estimator`, `vocoder`; configuración: `tts.json`, `unicode_indexer.json`.
- SHA-256 y tamaños de **cada uno de los siete archivos**: [`server/models/supertonic3-m1.json`](../../server/models/supertonic3-m1.json). El runtime verifica los hashes antes de cargar el modelo; un asset distinto falla cerrado.

Una instalación nueva puede ejecutar `npm ci` y después `npm run tts:install`. Ese instalador Node descarga únicamente los siete archivos fijados por revisión, verifica SHA-256 y reutiliza archivos ya correctos. Por defecto los deja en `data/models/supertonic3` (ignorado por Git). También acepta `--dir RUTA_ABSOLUTA`; configure `GUNTER_LOCAL_TTS_MODEL_DIR` o el privado `data/local-tts.json` si usa otra ruta. En la máquina de desarrollo actual se reutiliza `D:\gunter-supertonic3-poc\model`; no hay descarga duplicada ni dependencia de su entorno Python. El usuario debe activar conscientemente `tts.local`.

## Rendimiento medido en Ryzen 5 5500U

- PoC Node directa de una sola frase acordada: carga fría ~1,64 s; generación ~1,73 s; audio ~6,13 s; RTF ~0,28; RSS ~514 MB.
- HTTP con precarga (misma frase): respuesta WAV completa ~1,75–2,0 s. La primera muestra de audio está disponible al terminar ese WAV; no se afirma streaming de PCM parcial.
- Gate del runtime Windows: inicio <=5 s y RTF <1: **PASS** en esta máquina. No es una garantía para cualquier PC.
- Cadena real con voz humana FLEURS es_419 → Moonshine → Ministral en streaming → M1, motores precargados: STT final 2,716 s; primer token LLM 0,755 s; primera unidad hablable 2,157 s; primer segmento TTS 2,273 s. Primer WAV listo a los 7,146 s desde el fin de la grabación. El inicio audible no se midió y necesariamente ocurre después. `VOICE_LATENCY_OPTIMIZATION_PENDING`: objetivo futuro <=5 s; no bloquea el desarrollo funcional ni se optimiza en esta fase.
- Un guard en el proceso Node bloqueó `fetch` no-loopback durante la cadena y registró 0 intentos. No hubo aislamiento de egreso a nivel de sistema operativo para los ejecutables nativos; por tanto `LOCAL_ONLY offline` **no está certificado como PASS** todavía.

## Licencias y mantenimiento

El [repositorio oficial archivado](https://github.com/supertone-oss-archive/supertonic) indica que fue archivado el **2026-09-09** y que ya no habrá soporte, correcciones ni parches de seguridad. El código de referencia es **MIT**; los [pesos Supertonic 3](https://huggingface.co/Supertone/supertonic-3) son **OpenRAIL-M**, no MIT. La adaptación de la canalización ONNX en `server/local-tts-onnx.js` atribuye el código de referencia a Supertonic/Supertone. Copyright (c) 2026 Supertone Inc.

Antes de distribuir pesos o prestar el modelo a terceros deben conservarse avisos y licencia, comunicar e imponer las restricciones de uso de OpenRAIL-M y revisar las obligaciones de redistribución y el flujo comercial concreto. Esta fase **no** declara `COMMERCIAL_DISTRIBUTION_FULLY_CLEARED`. El riesgo de mantenimiento del upstream archivado queda abierto: Gunter debe fijar versiones/hashes y evaluar parches por cuenta propia.

## Gates siguientes, no implementados aquí

- Windows voz local: `IMPLEMENTED`; Supertonic 3 M1: `IMPLEMENTED`; calidad: `USER_APPROVED`.
- Latencia E2E actual: ~7 s hasta primer WAV; meta <=5 s; estado `OPTIMIZATION_PENDING`.
- `SUPERTONIC_WEB_RUNTIME_PENDING`: ONNX + WebWorker + WASM/WebGPU si corresponde, M1 y mismo texto.
- `ANDROID_TTS_PENDING_DEVICE_TEST`.
- `IOS_TTS_PENDING_DEVICE_TEST`.
- Certificación de aislamiento offline a nivel de sistema: `PENDING`.
- Revisión comercial completa de OpenRAIL-M: `PENDING`.
