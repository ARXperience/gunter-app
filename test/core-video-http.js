'use strict';
// Read-only native media checks against a running isolated development server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.GUNTER_URL || 'http://localhost:3001';
const asset = fs.readFileSync(path.join(__dirname, '../assets/gunter/gunter-core-video.mp4'));
const url = base + '/assets/gunter/gunter-core-video.mp4';
(async () => {
    let checks = 0;
    async function range(header, start, end, method = 'GET') {
        const response = await fetch(url, { method, headers: { Range: header } });
        assert.equal(response.status, 206);
        assert.equal(response.headers.get('content-type'), 'video/mp4');
        assert.equal(response.headers.get('accept-ranges'), 'bytes');
        assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${asset.length}`);
        assert.equal(Number(response.headers.get('content-length')), end - start + 1);
        const body = Buffer.from(await response.arrayBuffer());
        assert.deepEqual(body, method === 'HEAD' ? Buffer.alloc(0) : asset.subarray(start, end + 1));
        checks++;
    }
    await range('bytes=0-1', 0, 1); // Safari-style initial probe.
    await range('bytes=-128', asset.length - 128, asset.length - 1);
    await range(`bytes=${asset.length - 16}-`, asset.length - 16, asset.length - 1);
    await range('bytes=0-1', 0, 1, 'HEAD');
    for (const header of [`bytes=${asset.length}-`, 'bytes=20-10', 'bytes=-0', 'bytes=hello', 'bytes=0-1,3-4']) {
        const response = await fetch(url, { headers: { Range: header } });
        assert.equal(response.status, 416);
        assert.equal(response.headers.get('content-range'), `bytes */${asset.length}`);
        assert.equal((await response.arrayBuffer()).byteLength, 0);
        checks++;
    }
    const full = await fetch(url, { method: 'HEAD' });
    assert.equal(full.status, 200);
    assert.equal(Number(full.headers.get('content-length')), asset.length);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    checks++;
    console.log(`Core video HTTP: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
