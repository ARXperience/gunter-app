/* Optional Windows CPU/RAM/latency observation for the integrated native sidecar. */
'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const stt = require('../server/local-stt');

(async () => {
    if (!process.env.GUNTER_LOCAL_STT_MODEL_DIR || !process.env.GUNTER_LOCAL_STT_TEST_AUDIO)
        throw new Error('Set external model and audio paths');
    const samples = [];
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command',
        'while ($true) { $p = Get-Process transcriber -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { Write-Output "$($p.Id),$($p.WorkingSet64),$($p.CPU)" }; Start-Sleep -Milliseconds 80 }'],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let remainder = '';
    ps.stdout.on('data', chunk => {
        remainder += chunk.toString();
        const lines = remainder.split(/\r?\n/);
        remainder = lines.pop();
        for (const line of lines) {
            const [pid, rss, cpu] = line.trim().split(',').map(Number);
            if (Number.isFinite(pid) && Number.isFinite(rss) && Number.isFinite(cpu)) samples.push({ pid, rss, cpu });
        }
    });
    try {
        await new Promise(resolve => setTimeout(resolve, 500));
        const audio = fs.readFileSync(process.env.GUNTER_LOCAL_STT_TEST_AUDIO);
        const start = performance.now();
        const transcript = await stt.transcribeAudio(audio, 'audio/wav');
        const elapsed = Math.round(performance.now() - start);
        const peakMiB = samples.length ? Math.round(Math.max(...samples.map(s => s.rss)) / 1048576) : null;
        const cpu = samples.length > 1 ? +(Math.max(...samples.map(s => s.cpu)) - Math.min(...samples.map(s => s.cpu))).toFixed(2) : null;
        console.log(JSON.stringify({ elapsedMs: elapsed, peakWorkingSetMiB: peakMiB, processCpuSecondsObserved: cpu,
            samples: samples.length, transcriptChars: transcript.length }));
    } finally { ps.kill(); stt.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
