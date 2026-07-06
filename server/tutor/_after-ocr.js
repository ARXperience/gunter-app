/* Post-OCR pipeline: rebuild everything once OCR finishes.
   Run: node server/tutor/_after-ocr.js
*/
(async () => {
    console.log('[1/2] Rebuilding index…');
    require('./build-index');
    // Wait for main() invoked via require's require.main check — not applicable.
    // Instead call main directly if exported. Since build-index calls main() only when
    // require.main, we spawn it here.
    const { spawnSync } = require('child_process');
    let r = spawnSync('node', ['server/tutor/build-index.js'], { stdio: 'inherit' });
    if (r.status !== 0) { console.error('index failed'); process.exit(1); }

    console.log('\n[2/2] Rebuilding digests…');
    r = spawnSync('node', ['server/tutor/build-digests.js'], { stdio: 'inherit' });
    if (r.status !== 0) { console.error('digests failed'); process.exit(1); }

    console.log('\n✓ Todo listo. Reiniciá el server para que cargue el índice nuevo.');
})();
