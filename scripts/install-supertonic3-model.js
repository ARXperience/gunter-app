/* Explicit one-time asset installer; no model download occurs during inference. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { manifest, hashFile, verifyModelAssets } = require('../server/local-tts-assets');

async function main() {
    const arg = process.argv.indexOf('--dir');
    const modelDir = arg >= 0 ? process.argv[arg + 1] : path.join(__dirname, '..', 'data', 'models', 'supertonic3');
    if (!modelDir || !path.isAbsolute(modelDir) || path.parse(modelDir).root === path.resolve(modelDir))
        throw new Error('Provide an absolute model directory, not a filesystem root.');
    const base = `https://huggingface.co/${manifest.repo}/resolve/${manifest.revision}`;
    for (const [relative, expected] of Object.entries(manifest.files)) {
        const target = path.join(modelDir, relative);
        let exists = false;
        try { exists = (await fs.promises.stat(target)).isFile(); } catch { /* missing */ }
        if (exists) {
            const stat = await fs.promises.stat(target);
            if (stat.size !== expected.size || await hashFile(target) !== expected.sha256)
                throw new Error(`Existing asset differs from pinned manifest: ${relative}. Resolve manually; it was not overwritten.`);
            console.log(`Verified existing: ${relative}`);
            continue;
        }
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        const temporary = `${target}.partial-${process.pid}`;
        try {
            const response = await fetch(`${base}/${relative.split('/').map(encodeURIComponent).join('/')}`);
            if (!response.ok || !response.body) throw new Error(`Download ${relative}: HTTP ${response.status}`);
            await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { flags: 'wx' }));
            const stat = await fs.promises.stat(temporary);
            if (stat.size !== expected.size || await hashFile(temporary) !== expected.sha256)
                throw new Error(`Downloaded asset failed size/SHA-256 verification: ${relative}`);
            await fs.promises.rename(temporary, target);
            console.log(`Installed: ${relative}`);
        } catch (error) {
            await fs.promises.unlink(temporary).catch(() => {});
            throw error;
        }
    }
    await verifyModelAssets(modelDir);
    console.log(`Pinned Supertonic 3 M1 assets ready: ${modelDir}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
