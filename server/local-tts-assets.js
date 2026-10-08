/* Reproducible, pinned Supertonic 3 M1 model assets. No runtime downloads. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('./models/supertonic3-m1.json');

async function hashFile(file) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}
async function verifyModelAssets(modelDir) {
    if (!path.isAbsolute(modelDir)) throw new Error('MODEL_PATH_NOT_ABSOLUTE');
    for (const [relative, expected] of Object.entries(manifest.files)) {
        const file = path.join(modelDir, relative);
        const stat = await fs.promises.stat(file);
        if (!stat.isFile() || stat.size !== expected.size) throw new Error(`MODEL_ASSET_SIZE_MISMATCH:${relative}`);
        if (await hashFile(file) !== expected.sha256) throw new Error(`MODEL_ASSET_HASH_MISMATCH:${relative}`);
    }
    return { repo: manifest.repo, revision: manifest.revision, voice: manifest.voice };
}
module.exports = { manifest, hashFile, verifyModelAssets };
