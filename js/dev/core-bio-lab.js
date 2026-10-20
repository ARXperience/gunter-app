/* Manual QA surface for the real reusable renderer, not a second simulation. */
(function () {
    'use strict';
    const canvas = document.getElementById('core'), status = document.getElementById('status');
    const verify = document.getElementById('verification'), recordButton = document.getElementById('record');
    const download = document.getElementById('download'), recording = document.getElementById('recording');
    const controls = [...document.querySelectorAll('button, select, input')];
    const shapes = new Set(['organic','hand','eye','sword','jellyfish','butterfly','pentagram','dragon']);
    const config = { particleColor:'#c7e4f7', shadowColor:'#14273c', energyColor:'#5dcdff', glowColor:'#4f86ff',
        density:1, brightness:1, size:1, speed:1, shape:'organic', debugView:'energy' };
    const engine = new window.GunterIdleCore();
    let phase = 8, last = 0, frame = 0, paused = false, recorder = null, stream = null, timer = 0, blobUrl = '', lastVerify = 0, disposed = false;
    let cadenceStart = null, cadenceIntervals = 0, measuredFps = null;
    function updateStatus() {
        if (recorder || disposed) return;
        const cadence = measuredFps === null ? 'Cadencia: sin muestra'
            : `${measuredFps.toFixed(1).replace('.', ',')} cuadros/s medidos (renderTo)`;
        status.textContent = `WebGL2 disponible · ${paused?'Pausado':'Simulación activa'} · ${cadence} · sin audio ni amplitud simulada`;
    }
    function resetCadence() {
        cadenceStart = null; cadenceIntervals = 0; measuredFps = null;
        delete canvas.dataset.measuredFps;
    }
    function sampleRendered(now) {
        // Count intervals between completed renderTo calls against RAF elapsed
        // time, never against requested capture FPS or the clamped phase clock.
        if (cadenceStart === null || now < cadenceStart) {
            cadenceStart = now; cadenceIntervals = 0; return;
        }
        cadenceIntervals++;
        const elapsed = now - cadenceStart;
        if (elapsed >= 1000) {
            measuredFps = cadenceIntervals * 1000 / elapsed;
            canvas.dataset.measuredFps = measuredFps.toFixed(3);
            cadenceStart = now; cadenceIntervals = 0;
        }
    }
    function updateVerification(now, force = false) {
        if (!force && now - lastVerify < 1000) return;
        lastVerify = now;
        const context = canvas.getContext('2d'), alpha = context.getImageData(0, 0, 1, 1).data[3];
        verify.textContent = `Fondo del canvas: alfa ${alpha}/255 · Forma ${config.shape} · Vista ${config.debugView} · Densidad ${Math.round(config.density*100)} %`;
        canvas.dataset.shape = config.shape;
        canvas.dataset.debugView = config.debugView; canvas.dataset.alphaCorner = String(alpha);
    }
    function tick(now) {
        frame = 0;
        if (document.hidden || disposed) { last = 0; resetCadence(); return; }
        if (!last || now - last >= 1000/30) {
            if (last && !paused) phase += Math.min(.08,(now-last)/1000);
            last = now;
            try {
                engine.renderTo(canvas,620,620,phase,{...config,static:paused});
                sampleRendered(now); updateStatus();
                updateVerification(now);
            } catch (error) { resetCadence(); status.textContent = error.message; return; }
        }
        frame = requestAnimationFrame(tick);
    }
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
        config.debugView = button.dataset.view;
        document.querySelectorAll('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        lastVerify = 0;
    }));
    document.getElementById('shape').addEventListener('change', event => {
        if (!shapes.has(event.target.value)) return;
        config.shape = event.target.value;
        updateVerification(performance.now(), true);
    });
    document.getElementById('backdrop').addEventListener('change', event => { document.getElementById('stage').dataset.backdrop = event.target.value; });
    for (const [name, min, max] of [['density',.25,2],['brightness',.2,2.5],['speed',0,2],['size',.7,1.3]]) {
        document.getElementById(name).addEventListener('input', event => {
            const value = Number(event.target.value);
            if (!Number.isFinite(value) || value < min || value > max) return;
            config[name] = value;
            updateVerification(performance.now(), true);
        });
    }
    for (const name of ['particleColor','shadowColor','energyColor','glowColor']) {
        document.getElementById(name).addEventListener('input', event => {
            const value = event.target.value.trim();
            const valid = /^#[0-9a-f]{6}$/i.test(value);
            event.target.setAttribute('aria-invalid', String(!valid));
            if (valid) config[name] = value;
        });
    }
    document.getElementById('pause').addEventListener('click', event => {
        paused = !paused; event.target.setAttribute('aria-pressed', String(paused)); event.target.textContent = paused?'Reanudar':'Pausar';
    });
    canvas.addEventListener('pointermove', event => {
        if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
        const box = canvas.getBoundingClientRect();
        engine.setPointer((event.clientX-box.left-box.width/2)/(box.width/2),(box.top+box.height/2-event.clientY)/(box.height/2),true);
    },{passive:true});
    canvas.addEventListener('pointerleave',()=>engine.setPointer(0,0,false),{passive:true});
    function stopRecording() { if (recorder?.state === 'recording') recorder.stop(); }
    recordButton.addEventListener('click', () => {
        if (!window.MediaRecorder || !canvas.captureStream) { status.textContent = 'Este navegador no permite grabar el canvas.'; return; }
        const mimeType = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
        if (!mimeType) { status.textContent = 'No hay un códec de grabación disponible.'; return; }
        if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; }
        recording.hidden = true; recording.removeAttribute('src'); download.hidden = true;
        paused = false; document.getElementById('pause').textContent = 'Pausar'; document.getElementById('pause').setAttribute('aria-pressed','false');
        engine.resetPointer(); const chunks = [], view = config.debugView, shape = config.shape, started = performance.now();
        stream = canvas.captureStream(30);
        try { recorder = new MediaRecorder(stream,{mimeType,videoBitsPerSecond:4000000}); }
        catch(error) { stream.getTracks().forEach(track=>track.stop()); stream=null; status.textContent=error.message; return; }
        controls.forEach(control=>{control.disabled=true;});
        recorder.addEventListener('dataavailable',event=>{if(event.data.size)chunks.push(event.data);});
        recorder.addEventListener('stop',()=>{
            clearTimeout(timer); timer=0; stream?.getTracks().forEach(track=>track.stop()); stream=null;
            recorder=null; if(disposed)return;
            const seconds=(performance.now()-started)/1000;
            blobUrl=URL.createObjectURL(new Blob(chunks,{type:mimeType})); recorder=null;
            download.href=blobUrl; download.download=`gunter-bio-${shape}-${view}-${seconds.toFixed(1)}s.webm`; download.hidden=false;
            recording.src=blobUrl; recording.hidden=false;
            controls.forEach(control=>{control.disabled=false;}); status.textContent=`Grabación lista: ${seconds.toFixed(1)} segundos del canvas real, sin audio.`;
        });
        // Leave encoder startup margin; verify the actual file duration before using it as QA evidence.
        recorder.start(1000); timer=setTimeout(stopRecording,19000);
        status.textContent='Capturando 19 segundos, con margen para verificar al menos 15 segundos útiles…';
    });
    document.addEventListener('visibilitychange',()=>{
        if(document.hidden) { if(frame)cancelAnimationFrame(frame); frame=0; last=0; resetCadence(); updateStatus(); stopRecording(); engine.resetPointer(); }
        else if(!frame&&engine.available) { updateStatus(); frame=requestAnimationFrame(tick); }
    });
    window.addEventListener('pagehide',()=>{
        disposed=true;
        resetCadence();
        if(frame)cancelAnimationFrame(frame); clearTimeout(timer); stopRecording(); stream?.getTracks().forEach(track=>track.stop());
        if(blobUrl)URL.revokeObjectURL(blobUrl); engine.dispose();
    },{once:true});
    if(engine.available) { updateStatus(); frame=requestAnimationFrame(tick); } else status.textContent=engine.error;
})();
