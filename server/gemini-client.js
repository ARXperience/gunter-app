/* =============================================
   Server helper — Gemini Vision
   Describe imágenes para que el handler de WhatsApp
   las pueda procesar como si fueran texto.
   ============================================= */

const https = require('https');

const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

function hasKey() { return !!KEY; }

function describeImage(buffer, mimeType = 'image/jpeg', extraHint = '') {
    if (!hasKey()) return Promise.reject(new Error('GEMINI_API_KEY missing'));

    const prompt = `Describe esta imagen en español en ≤80 palabras.
Si es un recibo/factura: extrae empresa, valor, fecha de vencimiento.
Si es una foto de documento: resume su contenido.
Si es una imagen común: describe qué muestra.
${extraHint ? 'Contexto adicional: ' + extraHint : ''}
Responde texto plano, sin markdown.`;

    const body = {
        contents: [{
            role: 'user',
            parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } }
            ]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 400 }
    };
    const data = JSON.stringify(body);
    const opts = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    return new Promise((resolve, reject) => {
        const req = https.request(opts, res => {
            let out = '';
            res.on('data', c => { out += c; });
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`Gemini HTTP ${res.statusCode}: ${out.slice(0, 200)}`));
                try {
                    const parsed = JSON.parse(out);
                    const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    resolve(text.trim());
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(data); req.end();
    });
}

module.exports = { describeImage, hasKey };
