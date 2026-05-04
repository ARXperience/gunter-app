/* =============================================
   GUNTER APP - Audio Recorder Module
   Web Audio API + MediaRecorder Implementation
   ============================================= */

class GunterAudioRecorder {
    constructor(options = {}) {
        this.options = {
            onDataAvailable: options.onDataAvailable || (() => { }),
            onVisualize: options.onVisualize || (() => { }),
            onStateChange: options.onStateChange || (() => { }),
            onError: options.onError || console.error,
            mimeType: 'audio/webm;codecs=opus',
            ...options
        };

        this.mediaRecorder = null;
        this.audioContext = null;
        this.analyser = null;
        this.stream = null;
        this.chunks = [];
        this.isRecording = false;
        this.isPaused = false;
        this.startTime = null;
        this.animationFrame = null;
    }

    // Check browser support
    static isSupported() {
        return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    }

    // Request microphone access and initialize
    async init() {
        if (!GunterAudioRecorder.isSupported()) {
            throw new Error('Audio recording is not supported in this browser');
        }

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            // Set up audio context for visualization
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;

            const source = this.audioContext.createMediaStreamSource(this.stream);
            source.connect(this.analyser);

            // Fase 3 (Android-ready): cadena de fallback de mimeTypes.
            // Algunos dispositivos Android NO soportan webm/opus → caer a mp4/aac → wav.
            // Si TODOS fallan, usar el default del browser (sin pasar mimeType).
            const MIME_FALLBACK_CHAIN = [
                this.options.mimeType,           // preferencia del usuario (ej. webm/opus)
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/mp4;codecs=mp4a.40.2',    // AAC-LC (común en Android stock)
                'audio/mp4',
                'audio/ogg;codecs=opus',
                'audio/wav'
            ];
            let chosenMime = '';
            for (const m of MIME_FALLBACK_CHAIN) {
                if (m && MediaRecorder.isTypeSupported(m)) {
                    chosenMime = m;
                    break;
                }
            }
            try {
                this.mediaRecorder = chosenMime
                    ? new MediaRecorder(this.stream, { mimeType: chosenMime })
                    : new MediaRecorder(this.stream);   // último recurso: que el browser elija
                this.options.mimeType = this.mediaRecorder.mimeType || chosenMime || 'audio/webm';
                console.log('[audio-recorder] mimeType escogido:', this.options.mimeType);
            } catch (err) {
                throw new Error('No se pudo crear MediaRecorder con ningún codec disponible: ' + err.message);
            }

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.chunks.push(e.data);
                    this.options.onDataAvailable(e.data);
                }
            };

            this.mediaRecorder.onstart = () => {
                this.isRecording = true;
                this.isPaused = false;
                this.startTime = Date.now();
                this.options.onStateChange('recording');
                this.startVisualization();
            };

            this.mediaRecorder.onpause = () => {
                this.isPaused = true;
                this.options.onStateChange('paused');
            };

            this.mediaRecorder.onresume = () => {
                this.isPaused = false;
                this.options.onStateChange('recording');
            };

            this.mediaRecorder.onstop = () => {
                this.isRecording = false;
                this.isPaused = false;
                this.options.onStateChange('stopped');
                this.stopVisualization();
            };

            return true;
        } catch (error) {
            this.options.onError(error);
            throw error;
        }
    }

    // Start recording
    start() {
        if (!this.mediaRecorder) {
            throw new Error('Recorder not initialized. Call init() first.');
        }

        this.chunks = [];
        this.mediaRecorder.start(1000); // Collect data every second
    }

    // Pause recording
    pause() {
        if (this.mediaRecorder?.state === 'recording') {
            this.mediaRecorder.pause();
        }
    }

    // Resume recording
    resume() {
        if (this.mediaRecorder?.state === 'paused') {
            this.mediaRecorder.resume();
        }
    }

    // Stop recording and return blob
    stop() {
        return new Promise((resolve) => {
            if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
                resolve(null);
                return;
            }

            const handleStop = () => {
                const blob = new Blob(this.chunks, { type: this.mediaRecorder.mimeType });
                this.mediaRecorder.removeEventListener('stop', handleStop);
                resolve(blob);
            };

            this.mediaRecorder.addEventListener('stop', handleStop);
            this.mediaRecorder.stop();
        });
    }

    // Get recording duration in seconds
    getDuration() {
        if (!this.startTime) return 0;
        return Math.floor((Date.now() - this.startTime) / 1000);
    }

    // Start audio visualization
    startVisualization() {
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const visualize = () => {
            if (!this.isRecording) return;

            this.animationFrame = requestAnimationFrame(visualize);
            this.analyser.getByteFrequencyData(dataArray);

            // Calculate average volume
            const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength;

            // Send visualization data
            this.options.onVisualize({
                frequencies: Array.from(dataArray),
                average: average,
                peak: Math.max(...dataArray)
            });
        };

        visualize();
    }

    // Stop visualization
    stopVisualization() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    // Clean up resources
    destroy() {
        this.stopVisualization();

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }

        if (this.audioContext?.state !== 'closed') {
            this.audioContext?.close();
        }

        this.mediaRecorder = null;
        this.stream = null;
        this.chunks = [];
    }

    // Download recording as file
    downloadRecording(filename = 'gunter-recording.webm') {
        if (this.chunks.length === 0) return;

        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

// Export for use
window.GunterAudioRecorder = GunterAudioRecorder;
