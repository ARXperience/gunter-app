/* =============================================
   Server helper — Edge TTS (voces neuronales Microsoft)
   ---------------------------------------------
   v44 — Las voces gratuitas más humanas para español latino.
   Sin API key, sin cuota. Es el mismo motor del lector de
   Microsoft Edge (servicio no oficial — si algún día cambia,
   la cadena cae sola a Gemini TTS y luego al navegador).

   Voces mapeadas a los alias que ya usa el cliente:
     fable   → es-MX-DaliaNeural    (expresiva — la voz Gunter)
     nova    → es-CO-SalomeNeural   (cálida)
     shimmer → es-US-PalomaNeural   (brillante)
     alloy   → es-MX-JorgeNeural    (neutra masculina)
     echo    → es-US-AlonsoNeural   (informativa)
     onyx    → es-CO-GonzaloNeural  (grave)
   También acepta nombres Edge directos (es-XX-*Neural).
   ============================================= */

const VOICE_MAP = {
    fable:   'es-MX-DaliaNeural',
    nova:    'es-CO-SalomeNeural',
    shimmer: 'es-US-PalomaNeural',
    alloy:   'es-MX-JorgeNeural',
    echo:    'es-US-AlonsoNeural',
    onyx:    'es-CO-GonzaloNeural'
};

const TIMEOUT_MS = 15000;

let _lib = null;
function _load() {
    if (_lib) return _lib;
    _lib = require('msedge-tts');   // lazy: si el paquete falta, el caller cae a Gemini
    return _lib;
}

function available() {
    try { _load(); return true; } catch { return false; }
}

// Devuelve { buffer (mp3), mime: 'audio/mpeg' }
function synthesizeSpeech({ text, voice = 'fable', rate = null }) {
    const { MsEdgeTTS, OUTPUT_FORMAT } = _load();
    const voiceName = /Neural$/i.test(voice) ? voice : (VOICE_MAP[voice] || VOICE_MAP.fable);

    return new Promise(async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Edge TTS timeout')), TIMEOUT_MS);
        try {
            const tts = new MsEdgeTTS();
            await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
            // rate estilo '+10%' / '-10%' (opcional)
            const opts = rate ? { rate } : undefined;
            const { audioStream } = tts.toStream(String(text).slice(0, 4000), opts);
            const chunks = [];
            audioStream.on('data', c => chunks.push(c));
            audioStream.on('end', () => {
                clearTimeout(timer);
                const buffer = Buffer.concat(chunks);
                if (!buffer.length) return reject(new Error('Edge TTS: audio vacío'));
                resolve({ buffer, mime: 'audio/mpeg' });
            });
            audioStream.on('error', e => { clearTimeout(timer); reject(e); });
        } catch (e) {
            clearTimeout(timer);
            reject(e);
        }
    });
}

module.exports = { synthesizeSpeech, available, VOICE_MAP };
