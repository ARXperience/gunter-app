/* Manual QA surface for the real reusable renderer, not a second simulation. */
(function () {
    'use strict';
    const canvas = document.getElementById('core'), status = document.getElementById('status');
    const verify = document.getElementById('verification'), recordButton = document.getElementById('record');
    const download = document.getElementById('download'), recording = document.getElementById('recording');
    const controls = [...document.querySelectorAll('button, select, input')];
    const config = { particleColor:'#b8bec9', shadowColor:'#18202d', energyColor:'#ff452b', glowColor:'#ff6d35',
        density:1, brightness:1, size:1, speed:1, shape:'organic', debugView:'energy' };
    const engine = new window.GunterIdleCore();
    let phase = 8, last = 0, frame = 0, paused = false, recorder = null, stream = null, timer = 0, blobUrl = '', lastVerify = 0, disposed = false;
    function updateVerification(now) {
        if (now - lastVerify < 1000) return;
        lastVerify = now;
        const context = canvas.getContext('2d'), alpha = context.getImageData(0, 0, 1, 1).data[3];
        verify.textContent = `Fondo del canvas: alfa ${alpha}/255 · Vista ${config.debugView} · Densidad ${Math.round(config.density*100)} %`;
        canvas.dataset.debugView = config.debugView; canvas.dataset.alphaCorner = String(alpha);
    }
    function tick(now) {
        frame = 0;
        if (document.hidden || disposed) { last = 0; return; }
        if (!last || now - last >= 1000/30) {
            if (last && !paused) phase += Math.min(.08,(now-last)/1000);
            last = now;
            try {
                engine.renderTo(canvas,620,620,phase,{...config,static:paused});
                if (!recorder) status.textContent = `WebGL2 disponible · ${paused?'Pausado':'Simulación activa'} · sin audio ni amplitud simulada`;
                updateVerification(now);
            } catch (error) { status.textContent = error.message; return; }
        }
        frame = requestAnimationFrame(tick);
    }
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
        config.debugView = button.dataset.view;
        document.querySelectorAll('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        lastVerify = 0;
    }));
    document.getElementById('backdrop').addEventListener('change', event => { document.getElementById('stage').dataset.backdrop = event.target.value; });
    document.getElementById('density').addEventListener('input', event => { config.density = Number(event.target.value); });
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
        engine.resetPointer(); const chunks = [], view = config.debugView, started = performance.now();
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
            download.href=blobUrl; download.download=`gunter-bio-${view}-${seconds.toFixed(1)}s.webm`; download.hidden=false;
            recording.src=blobUrl; recording.hidden=false;
            controls.forEach(control=>{control.disabled=false;}); status.textContent=`Grabación lista: ${seconds.toFixed(1)} segundos del canvas real, sin audio.`;
        });
        // Leave encoder startup margin; verify the actual file duration before using it as QA evidence.
        recorder.start(1000); timer=setTimeout(stopRecording,19000);
        status.textContent='Capturando 19 segundos, con margen para verificar al menos 15 segundos útiles…';
    });
    document.addEventListener('visibilitychange',()=>{
        if(document.hidden) { if(frame)cancelAnimationFrame(frame); frame=0; last=0; stopRecording(); engine.resetPointer(); }
        else if(!frame&&engine.available)frame=requestAnimationFrame(tick);
    });
    window.addEventListener('pagehide',()=>{
        disposed=true;
        if(frame)cancelAnimationFrame(frame); clearTimeout(timer); stopRecording(); stream?.getTracks().forEach(track=>track.stop());
        if(blobUrl)URL.revokeObjectURL(blobUrl); engine.dispose();
    },{once:true});
    if(engine.available) frame=requestAnimationFrame(tick); else status.textContent=engine.error;
})();
