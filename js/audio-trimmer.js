/* =============================================
   GUNTER APP - Audio Trimmer Logic
   Performance Optimized
   ============================================= */

class GunterAudioTrimmer {
    constructor() {
        this.audioBuffer = null;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.startTime = 0;
        this.endTime = 0;
        this.duration = 0;

        this.overlay = document.getElementById('trimmer-overlay');
        this.canvas = document.getElementById('waveform-canvas');
        this.ctx = this.canvas.getContext('2d');

        this.handleStart = document.getElementById('handle-start');
        this.handleEnd = document.getElementById('handle-end');
        this.maskStart = document.getElementById('mask-start');
        this.maskEnd = document.getElementById('mask-end');

        this.displayStart = document.getElementById('time-start');
        this.displayEnd = document.getElementById('time-end');

        this.initEvents();
    }

    async loadAudio(file) {
        // v51 — Mostrar el overlay DE INMEDIATO: decodificar un WAV de 50+ MB
        // tarda varios segundos y antes parecía que el botón no hacía nada.
        this.show();
        const sub = this.overlay.querySelector('.trimmer-subtitle');
        const prevSub = sub ? sub.textContent : '';
        if (sub) sub.textContent = '⏳ Decodificando audio… los archivos grandes tardan unos segundos';
        try {
            const arrayBuffer = await file.arrayBuffer();
            this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.duration = this.audioBuffer.duration;
            this.startTime = 0;
            this.endTime = this.duration;

            this.renderWaveform();
            this.updateHandles();
            if (sub) sub.textContent = prevSub;
        } catch (e) {
            this.hide();
            if (sub) sub.textContent = prevSub;
            throw new Error('No se pudo decodificar el audio: ' + (e?.message || 'formato no soportado'));
        }
    }

    renderWaveform() {
        const width = this.canvas.width = this.canvas.offsetWidth * window.devicePixelRatio;
        const height = this.canvas.height = this.canvas.offsetHeight * window.devicePixelRatio;
        const data = this.audioBuffer.getChannelData(0);
        const step = Math.ceil(data.length / width);
        const amp = height / 2;

        this.ctx.clearRect(0, 0, width, height);
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#00d4ff';
        this.ctx.lineWidth = 1;

        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;
            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
            this.ctx.moveTo(i, (1 + min) * amp);
            this.ctx.lineTo(i, (1 + max) * amp);
        }
        this.ctx.stroke();
    }

    initEvents() {
        let isDragging = null;

        const onMove = (e) => {
            if (!isDragging) return;
            const rect = this.canvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const time = (x / rect.width) * this.duration;

            if (isDragging === 'start') {
                this.startTime = Math.min(time, this.endTime - 0.5);
            } else {
                this.endTime = Math.max(time, this.startTime + 0.5);
            }
            this.updateHandles();
        };

        const onUp = () => { isDragging = null; };

        this.handleStart.onmousedown = () => isDragging = 'start';
        this.handleEnd.onmousedown = () => isDragging = 'end';

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    updateHandles() {
        const startPct = (this.startTime / this.duration) * 100;
        const endPct = (this.endTime / this.duration) * 100;

        this.handleStart.style.left = `${startPct}%`;
        this.handleEnd.style.left = `${endPct}%`;

        this.maskStart.style.width = `${startPct}%`;
        this.maskEnd.style.left = `${endPct}%`;
        this.maskEnd.style.right = '0';

        this.displayStart.textContent = this.formatTime(this.startTime);
        this.displayEnd.textContent = this.formatTime(this.endTime);
    }

    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    }

    show() { this.overlay.classList.add('active'); }
    hide() { this.overlay.classList.remove('active'); }

    async getSelectedSlice() {
        // v51 — Remuestrea a 16 kHz MONO (estándar de voz para ASR):
        // un recorte de 5 min pasa de ~28 MB a ~9.6 MB y entra en el límite
        // del transcriptor (14 MB). Calidad de transcripción idéntica.
        const TARGET_RATE = 16000;
        const duration = Math.max(0.1, this.endTime - this.startTime);
        const frameCount = Math.ceil(duration * TARGET_RATE);

        const offlineCtx = new OfflineAudioContext(1, frameCount, TARGET_RATE);
        const source = offlineCtx.createBufferSource();
        source.buffer = this.audioBuffer;          // estéreo se mezcla a mono solo
        source.connect(offlineCtx.destination);
        source.start(0, this.startTime, duration);

        const renderedBuffer = await offlineCtx.startRendering();
        return this.bufferToWavBlob(renderedBuffer);
    }

    bufferToWavBlob(buffer) {
        const length = buffer.length * 2;
        const view = new DataView(new ArrayBuffer(44 + length));

        // RIFF chunk descriptor
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + length, true);
        this.writeString(view, 8, 'WAVE');

        // FMT sub-chunk
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, buffer.sampleRate, true);
        view.setUint32(28, buffer.sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);

        // Data sub-chunk
        this.writeString(view, 36, 'data');
        view.setUint32(40, length, true);

        const samples = buffer.getChannelData(0);
        let offset = 44;
        for (let i = 0; i < samples.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }

        return new Blob([view], { type: 'audio/wav' });
    }

    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
}

window.GunterAudioTrimmer = GunterAudioTrimmer;
