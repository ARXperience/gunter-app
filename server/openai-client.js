/* =============================================
   Server helper — OpenAI (chat + whisper)
   Reutilizable por /api/chat, /api/transcribe y
   el handler de WhatsApp.
   ============================================= */

const https = require('https');

const KEY = process.env.OPENAI_API_KEY || '';
const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-4o-mini';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'whisper-1';

function hasKey() { return !!KEY; }

function chatComplete({ messages, temperature = 0.4, maxTokens = 500, jsonMode = false, model }) {
    if (!hasKey()) return Promise.reject(new Error('OPENAI_API_KEY missing'));
    const body = {
        model: model || CHAT_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
    };
    const data = JSON.stringify(body);
    const opts = {
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${KEY}`,
            'Content-Length': Buffer.byteLength(data)
        }
    };
    return new Promise((resolve, reject) => {
        const req = https.request(opts, res => {
            let out = '';
            res.on('data', c => { out += c; });
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`OpenAI HTTP ${res.statusCode}: ${out.slice(0, 200)}`));
                try {
                    const parsed = JSON.parse(out);
                    resolve(parsed?.choices?.[0]?.message?.content || '');
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(data); req.end();
    });
}

function transcribeAudio(buffer, mimeType = 'audio/ogg', filename = 'audio.ogg') {
    if (!hasKey()) return Promise.reject(new Error('OPENAI_API_KEY missing'));
    return new Promise((resolve, reject) => {
        const boundary = '----gunter' + Date.now().toString(36);
        const parts = [];
        const pushField = (name, value) => {
            parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
        };
        pushField('model', WHISPER_MODEL);
        pushField('language', 'es');
        pushField('response_format', 'json');
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
        parts.push(buffer);
        parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
        const payload = Buffer.concat(parts);

        const opts = {
            hostname: 'api.openai.com',
            path: '/v1/audio/transcriptions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${KEY}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': payload.length
            }
        };
        const req = https.request(opts, res => {
            let out = '';
            res.on('data', c => { out += c; });
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`Whisper HTTP ${res.statusCode}: ${out.slice(0, 200)}`));
                try {
                    const parsed = JSON.parse(out);
                    resolve(parsed.text || '');
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(payload); req.end();
    });
}

/**
 * Text-to-speech via OpenAI TTS.
 * Returns an mp3 Buffer. Voices: alloy, echo, fable, onyx, nova, shimmer
 * Model: 'tts-1' (fast) or 'tts-1-hd' (higher quality, slower)
 */
function synthesizeSpeech({ text, voice = 'alloy', speed = 1.0, model = 'tts-1-hd', format = 'mp3' }) {
    if (!hasKey()) return Promise.reject(new Error('OPENAI_API_KEY missing'));
    const body = { model, input: String(text).slice(0, 4000), voice, response_format: format, speed };
    const data = JSON.stringify(body);
    const opts = {
        hostname: 'api.openai.com',
        path: '/v1/audio/speech',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${KEY}`,
            'Content-Length': Buffer.byteLength(data)
        }
    };
    return new Promise((resolve, reject) => {
        const req = https.request(opts, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    const err = Buffer.concat(chunks).toString('utf8');
                    return reject(new Error(`OpenAI TTS HTTP ${res.statusCode}: ${err.slice(0, 200)}`));
                }
                resolve(Buffer.concat(chunks));
            });
        });
        req.on('error', reject);
        req.write(data); req.end();
    });
}

module.exports = { chatComplete, transcribeAudio, synthesizeSpeech, hasKey };
