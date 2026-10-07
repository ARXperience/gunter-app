# Moonshine native sidecar (Windows x64)

`transcriber.cpp` adapts the official Moonshine Voice v0.1.5 C++ streaming example under MIT. It accepts only a controlled PCM16/mono/16 kHz WAV path from `server/local-stt.js`, emits completed VAD lines prefixed with `TRANSCRIPT_LINE`, and never downloads a model.

Development build: obtain the official `moonshine-voice-windows-x86_64` v0.1.5 SDK from the [Moonshine C++ example](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/examples/c%2B%2B/README.md). With MSVC x64 tools initialized, compile `transcriber.cpp` against the SDK `include/` and link `moonshine.lib`, `moonshine-utils.lib`, `ort-utils.lib`, `bin-tokenizer.lib`, and `onnxruntime.lib`. Place `onnxruntime.dll` beside the executable. The tested build used MSVC 14.50.35717 x86-host/x64-target, `/std:c++17 /EHsc /O2 /MD`.

The exact tested executable and DLL SHA-256 values live in `server/models/moonshine-small-streaming-es.json`. Builds with a different hash fail closed until explicitly validated and the manifest is updated. The binary and DLL are local build/installer artifacts and are intentionally excluded from Git. The model weights and benchmark audio are also external. Set `GUNTER_LOCAL_STT_RUNTIME_DIR` and `GUNTER_LOCAL_STT_MODEL_DIR` to absolute directories (or configure `data/local-stt.json`). Python is **not** a runtime prerequisite.

Commercial packaging is **not cleared**: `PACKAGING_LICENSE_WARNING_PENDING_VENDOR_CLARIFICATION`; `ffmpeg-static@5.3.0` includes a GPL-3.0-or-later binary that needs separate compliance review. See [LOCAL_STT.md](../../docs/architecture/LOCAL_STT.md).
