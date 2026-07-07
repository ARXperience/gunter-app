/* =============================================
   Genera las imágenes prism de Gunter con Gemini (v54)
   ---------------------------------------------
   Uso:  node scripts/gen-gunter-prism.js
   Requiere el server corriendo (lee el service token) y cuota
   free de imágenes disponible (se renueva a medianoche Pacífico).

   Crea:
     assets/gunter/gunter-prism-nobg.png  (pingüino aislado, fondo transparente)
     assets/gunter/gunter-prism.png       (escena completa — solo si no existe)
   ============================================= */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const svc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/service-token.json'), 'utf8')).token;
const BASE = process.env.GUNTER_URL || 'http://localhost:3001';

async function gen(prompt, outFile) {
    const r = await fetch(BASE + '/api/gemini-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + svc },
        body: JSON.stringify({ prompt })
    });
    if (r.status !== 200) {
        const err = (await r.text()).slice(0, 160);
        console.log(`✗ ${path.basename(outFile)}: HTTP ${r.status} — ${err}`);
        return false;
    }
    const d = await r.json();
    fs.writeFileSync(outFile, Buffer.from(d.data, 'base64'));
    console.log(`✅ ${path.basename(outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
    return true;
}

(async () => {
    const dir = path.join(ROOT, 'assets', 'gunter');

    // 1. Versión SIN FONDO (la que usan login + hero del dashboard)
    await gen(
        'Gunter the penguin from Adventure Time cartoon: small cute penguin, black body, white oval face and belly, tiny black eyes, small yellow-orange beak, flat cartoon style faithful to the show. He wears ONLY one accessory: a sleek futuristic collar necklace with a glowing cyan EYE-shaped amulet pendant (like a cybernetic eye). Nothing else — no suit, no clothes, no armor. Full body, standing, facing forward. Isolated on a fully TRANSPARENT background (PNG alpha channel), no scenery, no checkerboard pattern, no floor.',
        path.join(dir, 'gunter-prism-nobg.png')
    );

    // 2. Escena completa (solo si el usuario no guardó la suya)
    if (!fs.existsSync(path.join(dir, 'gunter-prism.png'))) {
        await gen(
            'A sleek matte-black robotic penguin standing in a futuristic concrete room with a circular window showing glaciers. Glowing cyan circuit-board lines trace across its body. Cold cinematic lighting, obsidian and teal tones, holographic dashboard panel floating beside it, photorealistic 3D render.',
            path.join(dir, 'gunter-prism.png')
        );
    } else {
        console.log('· gunter-prism.png ya existe — no se toca');
    }
})();
