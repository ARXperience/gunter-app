/* =============================================
   GUNTER APP - Audio Chunker Module
   Splits large audio files into chunks for Whisper API
   ============================================= */

class GunterAudioChunker {
    constructor() {
        this.MAX_CHUNK_SIZE_MB = 20; // Safe margin under 25 MB limit
        this.CHUNK_DURATION_MINUTES = 8; // Reduced to 8 min for high-quality audio safety
    }

    /**
     * Estimate file size based on duration and sample rate
     * @param {number} durationSeconds - Audio duration in seconds
     * @param {number} sampleRate - Sample rate (default 44100 Hz)
     * @param {number} channels - Number of channels (1 = mono, 2 = stereo)
     * @returns {number} Estimated size in MB
     */
    estimateFileSize(durationSeconds, sampleRate = 44100, channels = 1) {
        // WAV format: sample_rate * duration * channels * bytes_per_sample
        const bytesPerSample = 2; // 16-bit audio
        const sizeBytes = sampleRate * durationSeconds * channels * bytesPerSample;
        return sizeBytes / (1024 * 1024); // Convert to MB
    }

    /**
     * Calculate optimal number of chunks needed
     * @param {number} fileSizeMB - File size in MB
     * @param {number} durationSeconds - Audio duration in seconds
     * @returns {number} Number of chunks needed
     */
    calculateChunkCount(fileSizeMB, durationSeconds) {
        if (fileSizeMB <= this.MAX_CHUNK_SIZE_MB) {
            return 1; // No chunking needed
        }

        // Calculate chunks based on duration
        const chunkDurationSeconds = this.CHUNK_DURATION_MINUTES * 60;
        return Math.ceil(durationSeconds / chunkDurationSeconds);
    }

    /**
     * Split audio blob into time-based chunks using Web Audio API
     * @param {Blob} audioBlob - The audio file to split
     * @param {number} chunkDurationMinutes - Duration of each chunk in minutes
     * @returns {Promise<Array<{blob: Blob, index: number, startTime: number, endTime: number}>>}
     */
    async splitAudioByDuration(audioBlob, chunkDurationMinutes = 15) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        try {
            // Convert blob to ArrayBuffer
            const arrayBuffer = await audioBlob.arrayBuffer();

            // Decode audio data
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            const totalDuration = audioBuffer.duration;
            const chunkDurationSeconds = chunkDurationMinutes * 60;
            const numChunks = Math.ceil(totalDuration / chunkDurationSeconds);

            const chunks = [];

            for (let i = 0; i < numChunks; i++) {
                const startTime = i * chunkDurationSeconds;
                const endTime = Math.min((i + 1) * chunkDurationSeconds, totalDuration);
                const chunkDuration = endTime - startTime;

                // Create a new buffer for this chunk
                const chunkBuffer = audioContext.createBuffer(
                    audioBuffer.numberOfChannels,
                    Math.ceil(chunkDuration * audioBuffer.sampleRate),
                    audioBuffer.sampleRate
                );

                // Copy audio data for this time range
                for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
                    const sourceData = audioBuffer.getChannelData(channel);
                    const chunkData = chunkBuffer.getChannelData(channel);

                    const startSample = Math.floor(startTime * audioBuffer.sampleRate);
                    const endSample = Math.floor(endTime * audioBuffer.sampleRate);

                    for (let j = 0; j < chunkData.length; j++) {
                        chunkData[j] = sourceData[startSample + j] || 0;
                    }
                }

                // Convert buffer to WAV blob
                const chunkBlob = await this.audioBufferToWav(chunkBuffer);

                chunks.push({
                    blob: chunkBlob,
                    index: i,
                    startTime: startTime,
                    endTime: endTime,
                    duration: chunkDuration
                });
            }

            return chunks;

        } finally {
            await audioContext.close();
        }
    }

    /**
     * Convert AudioBuffer to WAV Blob
     * @param {AudioBuffer} audioBuffer - The audio buffer to convert
     * @returns {Promise<Blob>} WAV file blob
     */
    async audioBufferToWav(audioBuffer) {
        const numberOfChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const length = audioBuffer.length * numberOfChannels * 2;

        const buffer = new ArrayBuffer(44 + length);
        const view = new DataView(buffer);

        // WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + length, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, 1, true); // PCM format
        view.setUint16(22, numberOfChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numberOfChannels * 2, true); // byte rate
        view.setUint16(32, numberOfChannels * 2, true); // block align
        view.setUint16(34, 16, true); // bits per sample
        writeString(36, 'data');
        view.setUint32(40, length, true);

        // Write audio data
        const offset = 44;
        const channels = [];
        for (let i = 0; i < numberOfChannels; i++) {
            channels.push(audioBuffer.getChannelData(i));
        }

        let pos = 0;
        for (let i = 0; i < audioBuffer.length; i++) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, channels[channel][i]));
                view.setInt16(offset + pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                pos += 2;
            }
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    /**
     * Get audio metadata from blob
     * @param {Blob} audioBlob - The audio file
     * @returns {Promise<{duration: number, sampleRate: number, channels: number}>}
     */
    async getAudioMetadata(audioBlob) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        try {
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            return {
                duration: audioBuffer.duration,
                sampleRate: audioBuffer.sampleRate,
                channels: audioBuffer.numberOfChannels
            };
        } finally {
            await audioContext.close();
        }
    }

    /**
     * Validate if a blob is under the size limit
     * @param {Blob} blob - The blob to check
     * @returns {boolean} True if under limit
     */
    validateChunkSize(blob) {
        const sizeMB = blob.size / (1024 * 1024);
        return sizeMB <= this.MAX_CHUNK_SIZE_MB;
    }

    /**
     * Format time for display
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time (HH:MM:SS)
     */
    formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hrs > 0) {
            return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
        return `${mins}:${String(secs).padStart(2, '0')}`;
    }
}

// Export
window.GunterAudioChunker = GunterAudioChunker;
