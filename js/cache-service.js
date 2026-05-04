/* =============================================
   GUNTER APP - Cache Service
   Manages transcription caching with SHA-256 hashing
   ============================================= */

class GunterCacheService {
    constructor() {
        this.CACHE_PREFIX = 'gunter_transcription_';
        this.CACHE_EXPIRY_DAYS = 30;
        this.MAX_CACHE_SIZE_MB = 10;
        this.stats = {
            hits: 0,
            misses: 0,
            totalSaved: 0
        };

        this.loadStats();
        this.clearExpiredCache();
    }

    /**
     * Generate SHA-256 hash from audio blob
     * @param {Blob} blob - Audio file blob
     * @returns {Promise<string>} Hex string hash
     */
    async generateFileHash(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    /**
     * Get cached transcription if exists and not expired
     * @param {string} hash - File hash
     * @returns {string|null} Cached transcription or null
     */
    getCachedTranscription(hash) {
        const cacheKey = this.CACHE_PREFIX + hash;
        const cached = localStorage.getItem(cacheKey);

        if (!cached) {
            this.stats.misses++;
            this.saveStats();
            return null;
        }

        try {
            const data = JSON.parse(cached);
            const now = Date.now();
            const expiryTime = data.timestamp + (this.CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

            if (now > expiryTime) {
                // Expired, remove it
                localStorage.removeItem(cacheKey);
                this.stats.misses++;
                this.saveStats();
                return null;
            }

            this.stats.hits++;
            this.stats.totalSaved += data.size || 0;
            this.saveStats();

            console.log(`✨ Cache HIT for hash: ${hash.substring(0, 8)}...`);
            return data.transcription;

        } catch (error) {
            console.error('Cache read error:', error);
            localStorage.removeItem(cacheKey);
            this.stats.misses++;
            this.saveStats();
            return null;
        }
    }

    /**
     * Store transcription in cache
     * @param {string} hash - File hash
     * @param {string} transcription - Transcription text
     * @param {number} fileSize - Original file size in bytes
     */
    setCachedTranscription(hash, transcription, fileSize = 0) {
        const cacheKey = this.CACHE_PREFIX + hash;
        const data = {
            transcription: transcription,
            timestamp: Date.now(),
            size: fileSize,
            hash: hash
        };

        try {
            // Check cache size before adding
            this.manageCacheSize();

            localStorage.setItem(cacheKey, JSON.stringify(data));
            console.log(`💾 Cached transcription for hash: ${hash.substring(0, 8)}...`);
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                console.warn('⚠️ Cache quota exceeded, clearing old entries...');
                this.clearOldestEntries(5);
                try {
                    localStorage.setItem(cacheKey, JSON.stringify(data));
                } catch (e) {
                    console.error('Failed to cache even after cleanup:', e);
                }
            } else {
                console.error('Cache write error:', error);
            }
        }
    }

    /**
     * Clear expired cache entries
     */
    clearExpiredCache() {
        const now = Date.now();
        const expiryMs = this.CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        let cleared = 0;

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.CACHE_PREFIX)) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (now - data.timestamp > expiryMs) {
                        localStorage.removeItem(key);
                        cleared++;
                    }
                } catch (error) {
                    // Invalid entry, remove it
                    localStorage.removeItem(key);
                    cleared++;
                }
            }
        }

        if (cleared > 0) {
            console.log(`🧹 Cleared ${cleared} expired cache entries`);
        }
    }

    /**
     * Manage cache size to stay under limit
     */
    manageCacheSize() {
        const currentSize = this.getCurrentCacheSize();
        const maxSizeBytes = this.MAX_CACHE_SIZE_MB * 1024 * 1024;

        if (currentSize > maxSizeBytes) {
            console.warn(`⚠️ Cache size (${(currentSize / 1024 / 1024).toFixed(2)} MB) exceeds limit`);
            this.clearOldestEntries(3);
        }
    }

    /**
     * Get current cache size in bytes
     * @returns {number} Size in bytes
     */
    getCurrentCacheSize() {
        let totalSize = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.CACHE_PREFIX)) {
                const value = localStorage.getItem(key);
                totalSize += (key.length + value.length) * 2; // UTF-16 encoding
            }
        }
        return totalSize;
    }

    /**
     * Clear oldest cache entries
     * @param {number} count - Number of entries to remove
     */
    clearOldestEntries(count) {
        const entries = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.CACHE_PREFIX)) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    entries.push({ key, timestamp: data.timestamp });
                } catch (error) {
                    // Invalid entry, mark for removal
                    entries.push({ key, timestamp: 0 });
                }
            }
        }

        // Sort by timestamp (oldest first)
        entries.sort((a, b) => a.timestamp - b.timestamp);

        // Remove oldest entries
        const toRemove = entries.slice(0, count);
        toRemove.forEach(entry => {
            localStorage.removeItem(entry.key);
        });

        console.log(`🗑️ Removed ${toRemove.length} oldest cache entries`);
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache stats
     */
    getCacheStats() {
        const cacheSize = this.getCurrentCacheSize();
        const cacheSizeMB = (cacheSize / 1024 / 1024).toFixed(2);
        const hitRate = this.stats.hits + this.stats.misses > 0
            ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1)
            : 0;

        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            hitRate: hitRate + '%',
            totalSaved: this.stats.totalSaved,
            cacheSize: cacheSizeMB + ' MB',
            cacheSizeBytes: cacheSize
        };
    }

    /**
     * Load stats from localStorage
     */
    loadStats() {
        try {
            const saved = localStorage.getItem('gunter_cache_stats');
            if (saved) {
                this.stats = JSON.parse(saved);
            }
        } catch (error) {
            console.error('Failed to load cache stats:', error);
        }
    }

    /**
     * Save stats to localStorage
     */
    saveStats() {
        try {
            localStorage.setItem('gunter_cache_stats', JSON.stringify(this.stats));
        } catch (error) {
            console.error('Failed to save cache stats:', error);
        }
    }

    /**
     * Clear all cache
     */
    clearAllCache() {
        let cleared = 0;
        const keys = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.CACHE_PREFIX)) {
                keys.push(key);
            }
        }

        keys.forEach(key => {
            localStorage.removeItem(key);
            cleared++;
        });

        this.stats = { hits: 0, misses: 0, totalSaved: 0 };
        this.saveStats();

        console.log(`🗑️ Cleared all cache (${cleared} entries)`);
        return cleared;
    }

    /**
     * Get formatted cache info for display
     * @returns {string} Formatted cache info
     */
    getCacheInfo() {
        const stats = this.getCacheStats();
        return `Cache: ${stats.hits} hits, ${stats.misses} misses (${stats.hitRate} hit rate) | Size: ${stats.cacheSize}`;
    }
}

// Export
window.GunterCacheService = GunterCacheService;
