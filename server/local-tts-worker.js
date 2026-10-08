/* Persistent isolated Node/ONNX worker. stdout is JSON lines only. */
'use strict';
const readline = require('node:readline');
const { SupertonicOnnxRuntime } = require('./local-tts-onnx');

async function main() {
    const runtime = new SupertonicOnnxRuntime(process.env.GUNTER_LOCAL_TTS_MODEL_DIR);
    await runtime.start();
    process.stdout.write(JSON.stringify({ type: 'ready', ...runtime.health() }) + '\n');
    const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of input) {
        let request;
        try {
            request = JSON.parse(line);
            const { buffer } = await runtime.synthesize(request.text, request.speed);
            process.stdout.write(JSON.stringify({ type: 'audio', id: request.id,
                wav: buffer.toString('base64') }) + '\n');
        } catch (error) {
            process.stdout.write(JSON.stringify({ type: 'error', id: request?.id ?? null,
                error: String(error?.message || error).slice(0, 300) }) + '\n');
        }
    }
    runtime.stop();
}
main().catch(error => { console.error('local_tts_start_failed:', error); process.exitCode = 1; });
