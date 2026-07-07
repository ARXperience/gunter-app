/* =============================================
   Limpia el "checkerboard horneado" de los PNG de la mascota (v55)
   ---------------------------------------------
   Los assets gunter_transparent_*.png tenían la cuadrícula de
   transparencia RENDERIZADA en los píxeles (grises neutros 30-140,
   alpha 255). Este script hace flood-fill desde los bordes marcando
   como transparentes solo los grises neutros CONECTADOS al borde —
   la panza blanca y el cuerpo del pingüino quedan intactos.

   Uso: node scripts/fix-transparency.js
   (respalda los originales en backups/mascota-original/)
   ============================================= */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'assets', 'gunter');
const BACKUP = path.join(ROOT, 'backups', 'mascota-original');

// ¿Es un gris neutro de cuadrícula? (R≈G≈B, tono medio-oscuro)
function isChecker(r, g, b) {
    return Math.abs(r - g) <= 12 && Math.abs(g - b) <= 12 && Math.abs(r - b) <= 12
        && r >= 26 && r <= 150;
}

async function clean(file) {
    const src = path.join(DIR, file);
    const img = await loadImage(src);
    const W = img.width, H = img.height;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, W, H);
    const d = imgData.data;

    // BFS desde TODOS los píxeles del borde
    const visited = new Uint8Array(W * H);
    const queue = [];
    const push = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const p = y * W + x;
        if (visited[p]) return;
        const i = p * 4;
        if (!isChecker(d[i], d[i + 1], d[i + 2])) return;
        visited[p] = 1;
        queue.push(p);
    };
    for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }

    let cleared = 0;
    while (queue.length) {
        const p = queue.pop();
        const i = p * 4;
        d[i + 3] = 0;   // transparente
        cleared++;
        const x = p % W, y = (p / W) | 0;
        push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }

    ctx.putImageData(imgData, 0, 0);
    if (!fs.existsSync(BACKUP)) fs.mkdirSync(BACKUP, { recursive: true });
    fs.copyFileSync(src, path.join(BACKUP, file));
    fs.writeFileSync(src, canvas.toBuffer('image/png'));
    console.log(`✅ ${file}: ${(cleared / (W * H) * 100).toFixed(1)}% de fondo eliminado`);
}

(async () => {
    const files = fs.readdirSync(DIR).filter(f => /^gunter_transparent_.*\.png$/.test(f));
    console.log('Limpiando', files.length, 'archivos…');
    for (const f of files) {
        try { await clean(f); }
        catch (e) { console.log(`✗ ${f}: ${e.message}`); }
    }
})();
