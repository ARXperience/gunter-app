# Registro de decisiones de arquitectura

Este archivo documenta decisiones técnicas importantes de Gunter. Una tecnología mencionada en un plan es una candidata, no una decisión. No se integrará una opción nueva mientras falte alguno de estos criterios: compatibilidad demostrada, PoC aprobada, licencia revisada, costo esencial de $0, rollback definido, respaldo disponible, impacto identificado y pruebas definidas.

## Decisiones abiertas

### ADR-001 — Arquitectura de IA y voz offline

- **Estado:** fase 2 completada en PoC; **integración pendiente, ninguna tecnología aprobada**. Los resultados de «Actualización vinculante de fase 2» al final de este documento prevalecen sobre los candidatos provisionales anteriores. Véase [informe y medidas](TECH_VALIDATION_REPORT.md).
- **Fecha:** 2026-10-04.
- **Necesidad:** conversación, reconocimiento y síntesis de voz sin Internet en las plataformas objetivo, conservando el funcionamiento online actual.
- **Opciones evaluadas:** Qwen3 1.7B, Qwen3.5 2B, Phi-4-mini 3.8B y Ministral 3 3B en Ollama; Qwen3 1.7B en llama.cpp directo; Whisper tiny/base multilingüe int8 en sherpa-onnx; Piper es-MX y Kokoro español int8. Alternativas documentales: ExecuTorch, MLC LLM, ONNX Runtime GenAI, whisper.cpp, Qwen3-TTS, Chatterbox, Supertonic, wake-word engines.
- **PoC:** aislada en una carpeta temporal local fuera del repositorio (`gunter-validation-20261004`); no se alteraron las rutas de Gunter. Hardware: Ryzen 5 5500U, 19,39 GB RAM, Windows CPU. Cuatro prompts LLM; un audio humano público y tres sintéticos para STT; tres frases idénticas para cada TTS.
- **Resultados:** Qwen3 1.7B 3/4 prompts, 17,5–20,2 tok/s y 3,45 s a primera salida fría; los otros modelos 2/4. Llamada estructurada en llama.cpp directo correcta, pero ninguna suite de seguridad completada. Whisper base transcribió el proverbio humano correctamente en 0,63 s / 2,448 s de audio y confundió «Gunter» en voz sintética. Piper produjo cada WAV completo en 0,38–0,68 s; Kokoro en 7,69–9,82 s. RAM de proceso y pesos en el informe. No se midió calidad humana, batería ni móvil.
- **Solución elegida:** **ninguna para producción**. Preferencia experimental Windows: Qwen3 1.7B + llama.cpp; sherpa-onnx + Whisper base; Piper si se resuelve licencia y calidad; push-to-talk mientras wake word esté pendiente.
- **Por qué no aprobar:** todos los LLM fallaron al menos una instrucción básica; STT falla en el nombre propio; TTS carece de escucha humana y cierre legal; no hay dispositivos Android/iOS ni prueba de wake word, seguridad, duración o integración de shell.
- **Alternativas descartadas/pospuestas:** Supertonic como base por repositorio archivado/soporte terminado; SenseVoice para español por idioma no soportado; Ministral-8B-2410 por licencia de investigación; cloud-only para función offline. Kokoro, Qwen3-TTS, Chatterbox y otros runtimes no se descartan universalmente: quedan sin PoC o con rendimiento/licencia pendiente.
- **Costo:** modelos/software local de candidatos disponibles sin pago por inferencia; almacenamiento, energía y mantenimiento reales no son cero. Ningún servicio de pago o credencial por usuario puede ser esencial para offline.
- **Licencia:** Qwen3/Whisper/sherpa-onnx/llama.cpp con licencias abiertas identificadas en el informe; distribución de Piper GPL-3.0, voces y dependencias `espeak-ng` requiere revisión legal. No deducir compatibilidad de una sola licencia de repositorio.
- **Rollback:** mantener proveedores online y Web Speech actuales. Integrar solo mediante adaptador y flag por usuario/plataforma; desactivar flag restaura ruta anterior sin migración destructiva. Debe probarse cierre del motor, versión de modelo fijada y desinstalación antes de lanzamiento.
- **Impacto y consumidores:** `server/control-plane/model-router.js`, `js/services/nlp-llm-service.js`, `js/services/voice-service.js`, `js/services/wake-word-service.js`, `js/transcription-service.js`, `js/services/gunter-companion.js`, `server.js`, shells y hosts `gunter-mobile/`. No se modificaron en esta validación.
- **Backup:** no aplica a la PoC aislada. Antes de tocar conversaciones, recuerdos o ajustes: exportación versionada, restauración comprobada y consentimiento.
- **Pruebas:** gates detallados en el informe: 100+ casos españoles LLM y cero acciones no autorizadas; voz real, wake/VAD/interrupciones, escucha TTS, licencia final; Windows shell y Android/iOS físicos offline; batería/RAM; contratos y regresión completa.

### ADR-002 — Datos locales y sincronización entre dispositivos

- **Estado:** PoC ficticia completada; **integración no aprobada ni implementada**. Véase la actualización vinculante de fase 2 al final.
- **Fecha:** 2026-10-04.
- **Necesidad:** datos útiles sin conexión y reconciliación segura al volver Internet, sin repetir acciones externas.
- **Arquitectura actual:** PWA con IndexedDB/localStorage; `connection-manager` conserva una outbox limitada a `settings.patch`, que no equivale a sync general. Nodos móviles/PC no comparten aún una base local común.
- **Candidatos:** SQLite por host nativo, IndexedDB en PWA, backend existente y outbox versionada con claves idempotentes, tombstones y política de conflictos visible.
- **PoC/compatibilidad:** no realizadas en Windows, Android ni iOS; no se seleccionó driver ni mecanismo de cifrado.
- **Costo y licencia:** SQLite es de dominio público; PostgreSQL es software libre si se necesita servidor, pero alojamiento/copia/operación pueden costar. No exigir servicio pago como requisito esencial.
- **Impacto/seguridad:** conversación, tareas, agenda, archivos y preferencias requieren esquema y propiedad por usuario/dispositivo; sincronizar no concede permiso para enviar mensajes ni ejecutar comandos pendientes.
- **Backup y rollback:** exportación/restauración verificada y migración reversible antes de escribir datos productivos; conservar stores actuales hasta paridad. Ante fallo, desactivar sync sin perder cola ni provocar replay.
- **Pruebas para aprobación:** dos dispositivos editando offline, conflictos, duplicados, borrados/tombstones, credenciales vencidas, red intermitente, reinicio y restauración. No aprobada hasta dispositivos físicos y test de pérdida/corrupción.

## Actualización vinculante de fase 2 — 2026-10-04

Esta fase usó únicamente `gunter-validation-poc/` (directorio hermano local) para PoC y datos ficticios. El informe actualizado incluye fuentes, mediciones y límites. **No se sustituyeron endpoints, datos ni shells productivos.**

### ADR-001: decisión de IA y voz actualizada

- **Estado:** LLM, runtime, STT, TTS desktop/mobile `PENDING`; KWS GigaSpeech inglés probado `REJECTED` para «Gunter». Embeddings `PENDING` por no ser gate evaluado en esta fase.
- **Medidas y compatibilidad:** Qwen3 1.7B tras optimización de prompt/JSON Schema 83/120 exactos, 120/120 salidas JSON válidas; Ministral 3 3B 105/120, 115/120 válidas. La suite se ejecutó en Ollama CPU; llama.cpp solo tenía prueba directa pequeña previa y debe repetir la suite. Barrera determinista simulada: 0 acciones no autorizadas ejecutadas, sin conexión a acciones reales. Qwen falla prioridades, ambigüedad y recuperación bajo el contrato; Ministral es más acertado y más lento. Whisper base reconoce «Gunter» 3/36 literal, 4/36 tras normalización conservadora en audio sintético. KWS inglés 0/12 positivos. La voz real del usuario sigue pendiente.
- **Solución experimental, no productiva:** probar Ministral 3 3B para razonamiento guiado en hardware capaz; mantener Qwen3 1.7B como opción ligera para chat/resumen/sugerencias de bajo riesgo. Ninguno decide autónomamente acciones externas: validación, allowlist, permisos y confirmación independientes son obligatorios. Pulsar-para-hablar sigue siendo fallback. Whisper base requiere mejorar reconocimiento del nombre. KWS probado no sirve para este vocativo. No se elige TTS por naturalidad sin escucha humana.
- **TTS:** Piper 0,38–0,68 s por frase; Kokoro 7,69–9,82 s; Qwen3-TTS 0.6B CPU 60,11–99,51 s por las mismas frases y hasta ~5,3 GB RSS, por lo que esta configuración no cumple latencia interactiva. Samples persistentes fuera del código productivo. `LICENSE_REVIEW_REQUIRED` para Piper/espeak-ng, la ruta española de Kokoro/espeak-ng/phonemizer y empaquetado de Qwen3-TTS; código/pesos principales permisivos no despejan toda la cadena.
- **Criterio de aprobación/rollback:** repetir suite en runtime elegido, resolver errores y permiso cero, verificar grabación humana y prueba de escucha, licencias, carga concurrente y dispositivos; conservar proveedores y pulsar-para-hablar actuales mediante adaptador/flag. La PoC no migró nada.

### ADR-002: decisión de datos y sync actualizada

- **Estado:** base local, backup y sync `PENDING` para Gunter, aunque las PoC ficticias pasaron.
- **Medidas:** `node:sqlite` 12/12: CRUD, propietario, versión/tombstone, transacciones y salida abrupta, WAL, migración v1→v2, backup SHA-256/restauración de seis categorías ficticias. Sync simulado 9/9: A/B offline, operación/idempotencia persistente, conflicto visible, reintento, caída, duplicado y rechazo de acciones externas por cliente y servidor. Una colisión inicial de IDs se corrigió en la PoC manteniendo secuencia persistente.
- **Pendiente:** cifrado y permisos de backup, migración reversible de stores reales, contratos completos `DataRepository` en IndexedDB y hosts, backend real, múltiples usuarios, credenciales vencidas, dos dispositivos físicos, pérdida/corrupción. No sincronizar conversaciones sin consentimiento. **Sync de estado nunca reejecuta envío de mensajes, borrado de archivos ni comandos.** Conservamos los stores actuales como rollback; no hay migración productiva.

### ADR-003 — Shells desktop/móvil (PoC sin migración)

- **Estado:** Windows `PENDING`, Android `PENDING`, iOS `PENDING`; ninguna migración productiva autorizada.
- **Necesidad:** UI web compartida con capacidades locales delimitadas por plataforma y puente de permisos verificable.
- **PoC Windows:** Electron 44.5.1 aislado; HTML/CSS/JS + proceso Node localhost, preload/contextBridge, IPC con origen permitido, aislamiento de contexto, sandbox y sin integración Node en página. Inicio, cierre y reinicio de helper pasaron. ~292 MB de working sets Electron con UI de prueba, además del LLM si reside. No se cargó UI completa ni se empaquetó, firmó o instaló.
- **PoC Android:** copia aislada con `applicationId` distinto; WebViewAssetLoader, puente de mensaje con allowlist de origen/marco/acción y solo `status` de lectura, sin objetos genéricos. Build bloqueado antes de compilar por `Unable to establish loopback connection` de Gradle/JDK en este equipo y dependencia WebKit no cacheada. `adb` sin dispositivo. No afirmar funcionamiento Android.
- **iOS:** sin PoC ni Mac/Xcode/iPhone; WKWebView mínimo sigue hipótesis.
- **Licencia/costo:** Electron MIT como base, dependencias/redistribución y firma por revisar; Android SDK/AndroidX y términos de distribución por revisar; plataforma Apple y cuenta/distribución son costos potenciales. No se aprueba empaquetado comercial por la sola PoC.
- **Impacto/rollback:** conservar PWA/servidor y hosts actuales. Futuros shells tras flag y protocolo versionado; restaurar shell anterior sin modificar datos. La PoC no escribe en producción.
- **Pruebas pendientes:** UI real, auth multisesión, helper bajo carga, instalación/desinstalación, firma/rollback, dispositivo Android físico offline con memoria/temperatura/batería/permiso de micrófono, Mac/iPhone y revisión de puente WKWebView. Tauri solo se reconsiderará si hay un bloqueo real medido con Electron.

### ADR-004 — Fundación híbrida reversible (2026-10-04)

- **Estado:** implementada solo la capa de contratos, diagnóstico, política y flags; proveedores locales y SQLite siguen pendientes/no instalados.
- **Decisión:** `AUTO/STANDARD` conserva los motores y stores actuales; `LOCAL`/`LOCAL_ONLY` fallan cerrados con código explícito. El servidor aplica el bloqueo antes de invocar endpoints cloud; la web expone adapters y estado observables.
- **Seguridad:** registro de herramientas y confirmaciones existentes se amplían con validación determinista de propuesta y argumentos. No se delega ejecución libre al modelo.
- **Datos/sync:** repositorio web delegado y SQLite stub; outbox versionada solo para `settings.patch`; backup inventariado y manifiesto ficticio verificable, sin migración ni exportación real.
- **Rollback y pruebas:** rama/snapshot y resultados en [HYBRID_FOUNDATION.md](HYBRID_FOUNDATION.md). Esta ADR no aprueba motores, shells, sync general ni migración de datos.

## Plantilla para nuevas decisiones

### ADR-XXX — Título

- **Estado:** pendiente / aprobada / descartada / reemplazada.
- **Fecha:** AAAA-MM-DD.
- **Necesidad:**
- **Arquitectura actual y consumidores:**
- **Opciones evaluadas:**
- **Compatibilidad por plataforma:**
- **PoC y entorno aislado:**
- **Resultados medidos:**
- **Solución elegida:**
- **Por qué:**
- **Alternativas descartadas:**
- **Costo esencial y de mantenimiento:**
- **Licencia y uso comercial:**
- **Impacto en funciones existentes:**
- **Backup:**
- **Rollback:**
- **Pruebas y criterios de aceptación:**
