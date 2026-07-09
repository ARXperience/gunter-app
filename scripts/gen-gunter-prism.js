/* =============================================
   Genera el Gunter REALISTA con collar-ojo (v58)
   ---------------------------------------------
   Uso:  node scripts/gen-gunter-prism.js
   Requiere server corriendo + cuota free de imágenes
   (se renueva a medianoche Pacífico ≈ 2 AM Colombia).

   Pipeline: genera pingüino FOTORREALISTA sobre fondo blanco
   → flood-fill elimina el blanco desde los bordes → guarda
   assets/gunter/gunter-prism-nobg.png (transparente real).
   El dashboard/login lo prefieren sobre el SVG automáticamente.
   ============================================= */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.GUNTER_URL || 'http://localhost:3001';

const PROMPT = '3D stylized character render of a penguin, realistic-cartoonish style (Pixar / DreamWorks quality): expressive big eyes, soft detailed feather texture, classic black and white penguin with white belly and small orange beak, cute but with cinematic realistic lighting and subsurface scattering. It wears ONLY one accessory: a sleek futuristic high-tech collar band around its neck with a glowing cyan EYE-shaped lens amulet at the center, faint cyan rim light on its chest. No clothes, no suit. Full body, standing, facing slightly forward with a confident smirk. Isolated on a plain pure WHITE studio background, octane render, 8k.';

async function removeWhiteBg(buf) {
    const img = await loadImage(buf);
    const W = img.width, H = img.height;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, W, H);
    const d = imgData.data;
    // blanco/casi-blanco conectado al borde → transparente
    const ok = (r, g, b) => r >= 232 && g >= 232 && b >= 232;
    const visited = new Uint8Array(W * H); const queue = [];
    const push = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const p = y * W + x; if (visited[p]) return;
        const i = p * 4; if (!ok(d[i], d[i + 1], d[i + 2])) return;
        visited[p] = 1; queue.push(p);
    };
    for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
    let n = 0;
    while (queue.length) {
        const p = queue.pop(); const i = p * 4;
        d[i + 3] = 0; n++;
        const x = p % W, y = (p / W) | 0;
        push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }
    ctx.putImageData(imgData, 0, 0);
    console.log(`   fondo blanco eliminado: ${(n / (W * H) * 100).toFixed(1)}%`);
    return canvas.toBuffer('image/png');
}

(async () => {
    const svc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/service-token.json'), 'utf8')).token;
    const r = await fetch(BASE + '/api/gemini-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + svc },
        body: JSON.stringify({ prompt: PROMPT })
    });
    if (r.status !== 200) {
        console.log(`✗ HTTP ${r.status} — ${(await r.text()).slice(0, 140)}`);
        process.exit(1);
    }
    const d = await r.json();
    const raw = Buffer.from(d.data, 'base64');
    console.log(`✅ imagen generada (${(raw.length / 1024).toFixed(0)} KB) — limpiando fondo…`);
    const clean = await removeWhiteBg(raw);
    fs.writeFileSync(path.join(ROOT, 'assets/gunter/gunter-prism-nobg.png'), clean);
    console.log('✅ assets/gunter/gunter-prism-nobg.png listo (transparente real)');
})();
