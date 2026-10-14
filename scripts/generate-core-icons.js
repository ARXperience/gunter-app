/* Export the existing local SVG identity for PWA platforms requiring raster icons. */
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

async function generate() {
    const assetDir = path.join(__dirname, '..', 'assets', 'gunter');
    const source = await loadImage(fs.readFileSync(path.join(assetDir, 'gunter-core.svg')));
    for (const size of [192, 512]) {
        const canvas = createCanvas(size, size);
        const context = canvas.getContext('2d');
        context.fillStyle = '#0d0b14';
        context.fillRect(0, 0, size, size);
        // The important orbital geometry stays inside the central 80% safe
        // circle, including when the launcher applies a maskable crop.
        const inset = Math.round(size * .1);
        context.drawImage(source, inset, inset, size - inset * 2, size - inset * 2);
        const target = path.join(assetDir, `gunter-core-${size}.png`);
        fs.writeFileSync(target, await canvas.encode('png'));
        console.log(`Generated ${path.basename(target)} (${size}x${size})`);
    }
}

generate().catch(error => { console.error(error.message); process.exitCode = 1; });
