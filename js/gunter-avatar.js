/* =============================================
   GUNTER - Interactive SVG Avatar
   Mouse-following animation
   ============================================= */

class GunterAvatar {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.options = {
            size: options.size || 120,
            theme: options.theme || 'default',
            ...options
        };

        this.state = 'default';
        this.mode = options.mode || localStorage.getItem('gunter_env') || 'empresarial';
        this.mouseX = 0.5;
        this.mouseY = 0.5;
        this.targetX = 0.5;
        this.targetY = 0.5;
        this.blinkTimeout = null;
        this.isBlinking = false;

        this.init();

        // React to theme changes globally
        this._onTheme = (e) => {
            const newMode = e.detail?.theme;
            if (newMode) this.setMode(newMode);
        };
        window.addEventListener('themechange', this._onTheme);
    }

    init() {
        this.render();
        this.setupMouseTracking();
        this.startBlinking();
        this.animate();
        // Start ambient idle tics after 5s so entrance animations finish first
        setTimeout(() => this.startIdleLoop(), 5000);
    }

    render() {
        const size = this.options.size;

        this.container.innerHTML = `
            <svg class="gunter-svg" viewBox="0 0 100 100" width="${size}" height="${size}">
                <defs>
                    <!-- Glow filter -->
                    <filter id="gunter-glow-${this.container.id}" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2" result="blur"/>
                        <feMerge>
                            <feMergeNode in="blur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                    
                    <!-- Gradient for body -->
                    <linearGradient id="body-gradient-${this.container.id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#2a2a3e"/>
                        <stop offset="100%" style="stop-color:#1a1a2e"/>
                    </linearGradient>
                    
                    <!-- Belly gradient -->
                    <linearGradient id="belly-gradient-${this.container.id}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#f8f8ff"/>
                        <stop offset="100%" style="stop-color:#e8e8f0"/>
                    </linearGradient>
                </defs>
                
                <!-- Shadow -->
                <ellipse cx="50" cy="92" rx="25" ry="5" fill="rgba(0,0,0,0.2)" class="gunter-shadow"/>
                
                <!-- Body -->
                <ellipse cx="50" cy="58" rx="28" ry="32" fill="url(#body-gradient-${this.container.id})" class="gunter-body"/>
                
                <!-- Belly -->
                <ellipse cx="50" cy="62" rx="18" ry="22" fill="url(#belly-gradient-${this.container.id})" class="gunter-belly"/>
                
                <!-- Flippers -->
                <g class="gunter-flippers">
                    <ellipse cx="22" cy="58" rx="8" ry="16" fill="#1a1a2e" transform="rotate(-15 22 58)" class="gunter-flipper-left"/>
                    <ellipse cx="78" cy="58" rx="8" ry="16" fill="#1a1a2e" transform="rotate(15 78 58)" class="gunter-flipper-right"/>
                </g>
                
                <!-- Feet -->
                <ellipse cx="38" cy="88" rx="10" ry="5" fill="#ff6b35"/>
                <ellipse cx="62" cy="88" rx="10" ry="5" fill="#ff6b35"/>
                
                <!-- Head -->
                <circle cx="50" cy="30" r="22" fill="url(#body-gradient-${this.container.id})" class="gunter-head"/>
                
                <!-- Face mask (white area) -->
                <ellipse cx="50" cy="32" rx="14" ry="12" fill="white" class="gunter-face"/>
                
                <!-- Eyes container -->
                <g class="gunter-eyes">
                    <!-- Left eye -->
                    <g class="gunter-eye gunter-eye-left">
                        <circle cx="43" cy="28" r="5" fill="white" class="gunter-eye-white"/>
                        <circle cx="43" cy="28" r="3" fill="#1a1a2e" class="gunter-pupil gunter-pupil-left"/>
                        <circle cx="44" cy="27" r="1" fill="white" class="gunter-eye-shine"/>
                    </g>
                    <!-- Right eye -->
                    <g class="gunter-eye gunter-eye-right">
                        <circle cx="57" cy="28" r="5" fill="white" class="gunter-eye-white"/>
                        <circle cx="57" cy="28" r="3" fill="#1a1a2e" class="gunter-pupil gunter-pupil-right"/>
                        <circle cx="58" cy="27" r="1" fill="white" class="gunter-eye-shine"/>
                    </g>
                    <!-- Blink overlay (hidden by default) -->
                    <rect x="36" y="24" width="14" height="0" fill="#2a2a3e" class="gunter-blink-left"/>
                    <rect x="50" y="24" width="14" height="0" fill="#2a2a3e" class="gunter-blink-right"/>
                </g>
                
                <!-- Beak -->
                <polygon points="50,34 45,40 55,40" fill="#ff9500" class="gunter-beak"/>
                
                <!-- Mode-specific outfit layer (populated by setMode) -->
                <g class="gunter-outfit"></g>

                <!-- State indicator (glow ring) -->
                <circle cx="50" cy="50" r="45" fill="none" stroke="var(--accent-primary, #00d4ff)" stroke-width="2" opacity="0" class="gunter-state-ring" filter="url(#gunter-glow-${this.container.id})"/>
            </svg>
        `;

        // Cache elements
        this.svg = this.container.querySelector('.gunter-svg');
        this.leftPupil = this.container.querySelector('.gunter-pupil-left');
        this.rightPupil = this.container.querySelector('.gunter-pupil-right');
        this.stateRing = this.container.querySelector('.gunter-state-ring');
        this.leftFlipper = this.container.querySelector('.gunter-flipper-left');
        this.rightFlipper = this.container.querySelector('.gunter-flipper-right');
        this.blinkLeft = this.container.querySelector('.gunter-blink-left');
        this.blinkRight = this.container.querySelector('.gunter-blink-right');
        this.body = this.container.querySelector('.gunter-body');
        this.outfit = this.container.querySelector('.gunter-outfit');

        // Apply initial outfit
        this.setMode(this.mode);
    }

    setMode(mode) {
        this.mode = mode;
        if (!this.outfit) return;
        const outfits = {
            empresarial: `
                <!-- Tie -->
                <polygon points="50,42 46,48 54,48" fill="#1a2e4a"/>
                <polygon points="46,48 54,48 56,78 50,84 44,78" fill="#00d4ff"/>
                <rect x="36" y="41" width="28" height="2" fill="#1a2e4a"/>`,
            artistico: `
                <!-- Painter's beret -->
                <ellipse cx="50" cy="12" rx="18" ry="5" fill="#ff006e"/>
                <circle cx="62" cy="10" r="2" fill="#f8f8ff"/>
                <!-- Scarf -->
                <path d="M32,44 Q50,50 68,44 L66,52 Q50,58 34,52 Z" fill="#ffaa00" opacity="0.85"/>`,
            podcast: `
                <!-- Headphones band -->
                <path d="M28,22 Q50,2 72,22" stroke="#ffaa00" stroke-width="3" fill="none"/>
                <rect x="22" y="20" width="8" height="12" rx="3" fill="#ffaa00"/>
                <rect x="70" y="20" width="8" height="12" rx="3" fill="#ffaa00"/>
                <!-- Mic -->
                <rect x="48" y="72" width="4" height="10" rx="2" fill="#ffaa00"/>
                <circle cx="50" cy="70" r="3.5" fill="#2a1f0e" stroke="#ffaa00" stroke-width="1"/>`,
            zen: `
                <!-- Halo -->
                <ellipse cx="50" cy="10" rx="18" ry="3" fill="none" stroke="#e8c87a" stroke-width="1.5" opacity="0.9"/>
                <ellipse cx="50" cy="10" rx="14" ry="2" fill="#e8c87a" opacity="0.25"/>
                <!-- Robe/wrap -->
                <path d="M28,52 Q50,46 72,52 L74,84 Q50,92 26,84 Z" fill="#b48a48" opacity="0.85"/>
                <path d="M28,52 Q50,46 72,52" stroke="#e8c87a" stroke-width="1.5" fill="none"/>
                <!-- Lotus mark -->
                <circle cx="50" cy="68" r="2" fill="#e8c87a"/>`
        };
        this.outfit.innerHTML = outfits[mode] || outfits.empresarial;
    }

    setupMouseTracking() {
        document.addEventListener('mousemove', (e) => {
            const rect = this.container.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            // Calculate direction from center (normalized -1 to 1)
            const dx = (e.clientX - centerX) / window.innerWidth;
            const dy = (e.clientY - centerY) / window.innerHeight;

            this.targetX = 0.5 + dx * 2;
            this.targetY = 0.5 + dy * 2;
        });
    }

    animate() {
        // Smooth interpolation
        this.mouseX += (this.targetX - this.mouseX) * 0.1;
        this.mouseY += (this.targetY - this.mouseY) * 0.1;

        // Clamp values
        const lookX = Math.max(0, Math.min(1, this.mouseX));
        const lookY = Math.max(0, Math.min(1, this.mouseY));

        // Move pupils (range: -2 to +2 within eye)
        const pupilOffsetX = (lookX - 0.5) * 4;
        const pupilOffsetY = (lookY - 0.5) * 3;

        if (this.leftPupil && !this.isBlinking) {
            this.leftPupil.setAttribute('cx', 43 + pupilOffsetX);
            this.leftPupil.setAttribute('cy', 28 + pupilOffsetY);
        }
        if (this.rightPupil && !this.isBlinking) {
            this.rightPupil.setAttribute('cx', 57 + pupilOffsetX);
            this.rightPupil.setAttribute('cy', 28 + pupilOffsetY);
        }

        // Subtle body tilt based on look direction
        if (this.body) {
            const tiltX = pupilOffsetX * 0.5;
            this.svg.style.transform = `rotate(${tiltX}deg)`;
        }

        // Flipper wave animation when listening
        if (this.state === 'listening' && this.leftFlipper) {
            const wave = Math.sin(Date.now() / 200) * 5;
            this.leftFlipper.setAttribute('transform', `rotate(${-15 + wave} 22 58)`);
            this.rightFlipper.setAttribute('transform', `rotate(${15 - wave} 78 58)`);
        }

        requestAnimationFrame(() => this.animate());
    }

    startBlinking() {
        const blink = () => {
            this.blink();
            // Random interval between 2-5 seconds
            this.blinkTimeout = setTimeout(blink, 2000 + Math.random() * 3000);
        };
        this.blinkTimeout = setTimeout(blink, 2000 + Math.random() * 2000);
    }

    blink() {
        if (!this.blinkLeft || !this.blinkRight) return;

        this.isBlinking = true;

        // Close eyes
        this.blinkLeft.setAttribute('height', '10');
        this.blinkRight.setAttribute('height', '10');

        setTimeout(() => {
            // Open eyes
            this.blinkLeft.setAttribute('height', '0');
            this.blinkRight.setAttribute('height', '0');
            this.isBlinking = false;
        }, 100);
    }

    setState(state) {
        this.state = state;

        const colors = {
            default: 'var(--accent-primary, #00d4ff)',
            listening: '#00ff88',
            analyzing: '#ffaa00',
            alert: '#ff4444',
            celebration: '#ff00ff'
        };

        if (this.stateRing) {
            this.stateRing.setAttribute('stroke', colors[state] || colors.default);
            this.stateRing.style.opacity = state === 'default' ? '0' : '0.6';

            // Pulsing animation for active states
            if (state !== 'default') {
                this.stateRing.style.animation = 'gunterPulse 1.5s ease-in-out infinite';
            } else {
                this.stateRing.style.animation = 'none';
            }
        }

        // Special animations per state
        if (state === 'celebration') {
            this.celebrate();
        }
    }

    celebrate() {
        this.playAnimation('dance');
    }

    /**
     * Play one of Gunter's expressive animations.
     * Triggers a CSS keyframe sequence on the SVG and/or sub-parts.
     * Automatically cleans up after the animation finishes.
     */
    playAnimation(name, opts = {}) {
        if (!this.svg) return;
        const duration = opts.duration || DEFAULT_DURATIONS[name] || 1200;
        // Cancel previous animation cleanly
        this.svg.style.animation = 'none';
        if (this.leftFlipper) this.leftFlipper.style.animation = 'none';
        if (this.rightFlipper) this.rightFlipper.style.animation = 'none';
        if (this.body) this.body.style.animation = 'none';
        // Reflow to restart animations
        void this.svg.offsetWidth;

        switch (name) {
            case 'dance':
                this.svg.style.animation = `gunterDance ${duration}ms ease-in-out`;
                if (this.leftFlipper)  this.leftFlipper.style.animation  = `gunterFlipperWave ${duration / 4}ms ease-in-out infinite`;
                if (this.rightFlipper) this.rightFlipper.style.animation = `gunterFlipperWave ${duration / 4}ms ease-in-out infinite reverse`;
                break;
            case 'laugh':
                this.svg.style.animation = `gunterLaugh ${duration}ms cubic-bezier(.22,.61,.36,1)`;
                if (this.leftFlipper)  this.leftFlipper.style.animation  = `gunterFlipperShake ${duration / 5}ms ease-in-out infinite`;
                if (this.rightFlipper) this.rightFlipper.style.animation = `gunterFlipperShake ${duration / 5}ms ease-in-out infinite reverse`;
                break;
            case 'play':
                this.svg.style.animation = `gunterPlay ${duration}ms ease-in-out`;
                break;
            case 'wave':
                if (this.rightFlipper) this.rightFlipper.style.animation = `gunterWaveFlipper ${duration}ms ease-in-out`;
                this.svg.style.animation = `gunterLeanSlight ${duration}ms ease-in-out`;
                break;
            case 'applaud':
                if (this.leftFlipper)  this.leftFlipper.style.animation  = `gunterApplaudL ${duration / 5}ms ease-in-out infinite`;
                if (this.rightFlipper) this.rightFlipper.style.animation = `gunterApplaudR ${duration / 5}ms ease-in-out infinite`;
                this.svg.style.animation = `gunterBounceSmall ${duration / 5}ms ease-in-out infinite`;
                break;
            case 'think':
                this.svg.style.animation = `gunterThink ${duration}ms ease-in-out`;
                // Tilt head slightly by shifting look direction up-left
                this.targetX = 0.3;
                this.targetY = 0.25;
                break;
            case 'nod':
                this.svg.style.animation = `gunterNod ${duration}ms ease-in-out`;
                break;
            case 'shake':
                this.svg.style.animation = `gunterShakeNo ${duration}ms ease-in-out`;
                break;
            case 'idea':
                this.svg.style.animation = `gunterJump ${duration}ms cubic-bezier(.3,2,.4,1)`;
                break;
            case 'listening':
                if (this.leftFlipper)  this.leftFlipper.style.animation  = `gunterFlipperWave ${duration}ms ease-in-out infinite`;
                if (this.rightFlipper) this.rightFlipper.style.animation = `gunterFlipperWave ${duration}ms ease-in-out infinite reverse`;
                break;
            case 'sway':
            default:
                this.svg.style.animation = `gunterSway ${duration}ms ease-in-out`;
                break;
        }

        // Auto-cleanup after duration (unless it's a looping state)
        if (!['listening'].includes(name)) {
            clearTimeout(this._animTimeout);
            this._animTimeout = setTimeout(() => {
                this.svg.style.animation = '';
                if (this.leftFlipper)  this.leftFlipper.style.animation  = '';
                if (this.rightFlipper) this.rightFlipper.style.animation = '';
                if (this.body) this.body.style.animation = '';
            }, duration + 60);
        }
    }

    /**
     * Schedule a small idle "tic" animation every 8-20 seconds, reactive
     * to the current mode so the character feels alive.
     */
    startIdleLoop() {
        if (this._idleTimer) clearTimeout(this._idleTimer);
        const schedule = () => {
            const delay = 8000 + Math.random() * 12000;
            this._idleTimer = setTimeout(() => {
                // Skip if a deliberate state is active
                if (['analyzing', 'alert'].includes(this.state)) { schedule(); return; }
                const byMode = {
                    empresarial: ['sway', 'nod', 'think'],
                    artistico:   ['sway', 'idea', 'laugh'],
                    podcast:     ['dance', 'wave', 'laugh', 'applaud'],
                    zen:         ['sway', 'nod', 'think']
                };
                const pool = byMode[this.mode] || byMode.empresarial;
                const pick = pool[Math.floor(Math.random() * pool.length)];
                this.playAnimation(pick, { duration: 1600 });
                schedule();
            }, delay);
        };
        schedule();
    }

    stopIdleLoop() {
        if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
    }

    destroy() {
        if (this.blinkTimeout) {
            clearTimeout(this.blinkTimeout);
        }
        if (this._onTheme) {
            window.removeEventListener('themechange', this._onTheme);
        }
    }
}

// Per-animation default durations (ms)
const DEFAULT_DURATIONS = {
    dance: 2400, laugh: 1600, play: 1800, wave: 1500,
    applaud: 1800, think: 2000, nod: 900, shake: 900,
    idea: 1200, sway: 2000, listening: 600
};

// Keyframes / expressive animation CSS
const gunterStyles = document.createElement('style');
gunterStyles.textContent = `
    .gunter-svg {
        transition: transform 0.3s ease;
        filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
        transform-origin: 50% 70%;
    }
    .gunter-svg:hover {
        filter: drop-shadow(0 6px 14px rgba(0,0,0,0.45));
    }
    .gunter-state-ring { transform-origin: center; }

    @keyframes gunterPulse {
        0%, 100% { opacity: 0.4; transform: scale(1); }
        50%      { opacity: 0.85; transform: scale(1.06); }
    }
    @keyframes gunterBounce {
        0%, 100% { transform: translateY(0) rotate(0); }
        25%      { transform: translateY(-10px) rotate(-5deg); }
        50%      { transform: translateY(0) rotate(0); }
        75%      { transform: translateY(-10px) rotate(5deg); }
    }
    @keyframes gunterBounceSmall {
        0%, 100% { transform: translateY(0); }
        50%      { transform: translateY(-4px); }
    }

    /* DANCE — rhythmic hip sway + vertical hop */
    @keyframes gunterDance {
        0%   { transform: translateY(0) rotate(0); }
        15%  { transform: translateY(-6px) rotate(-7deg); }
        30%  { transform: translateY(0) rotate(-3deg); }
        45%  { transform: translateY(-8px) rotate(7deg); }
        60%  { transform: translateY(0) rotate(3deg); }
        75%  { transform: translateY(-5px) rotate(-5deg); }
        100% { transform: translateY(0) rotate(0); }
    }

    /* LAUGH — body shakes as belly bounces */
    @keyframes gunterLaugh {
        0%, 100% { transform: translateY(0) scale(1); }
        10%      { transform: translateY(-3px) scale(1.04, 0.96); }
        20%      { transform: translateY(0) scale(0.97, 1.03); }
        30%      { transform: translateY(-3px) scale(1.03, 0.97); }
        40%      { transform: translateY(0) scale(0.98, 1.02); }
        50%      { transform: translateY(-2px) scale(1.02, 0.98); }
        65%      { transform: translateY(0) scale(1); }
    }

    /* PLAY — bouncing left-right with spring */
    @keyframes gunterPlay {
        0%   { transform: translateX(0) rotate(0); }
        25%  { transform: translateX(-10px) rotate(-10deg); }
        50%  { transform: translateX(8px) rotate(10deg); }
        75%  { transform: translateX(-6px) rotate(-6deg); }
        100% { transform: translateX(0) rotate(0); }
    }

    /* THINK — subtle head tilt + rise */
    @keyframes gunterThink {
        0%   { transform: rotate(0) translateY(0); }
        30%  { transform: rotate(-6deg) translateY(-4px); }
        60%  { transform: rotate(-6deg) translateY(-4px); }
        100% { transform: rotate(0) translateY(0); }
    }

    /* NOD — yes */
    @keyframes gunterNod {
        0%, 100% { transform: rotateX(0); }
        25%      { transform: translateY(2px); }
        50%      { transform: translateY(-2px); }
        75%      { transform: translateY(2px); }
    }

    /* SHAKE NO */
    @keyframes gunterShakeNo {
        0%, 100% { transform: translateX(0); }
        20%      { transform: translateX(-4px); }
        40%      { transform: translateX(4px); }
        60%      { transform: translateX(-3px); }
        80%      { transform: translateX(3px); }
    }

    /* IDEA — jump up with a spark */
    @keyframes gunterJump {
        0%   { transform: translateY(0); }
        40%  { transform: translateY(-18px); }
        100% { transform: translateY(0); }
    }

    /* SWAY — idle gentle motion */
    @keyframes gunterSway {
        0%, 100% { transform: rotate(0); }
        50%      { transform: rotate(2deg); }
    }

    /* LEAN for waving */
    @keyframes gunterLeanSlight {
        0%, 100% { transform: rotate(0); }
        50%      { transform: rotate(-4deg); }
    }

    /* FLIPPER animations */
    @keyframes gunterFlipperWave {
        0%, 100% { transform: rotate(-15deg); transform-origin: 22px 50px; }
        50%      { transform: rotate(-40deg); transform-origin: 22px 50px; }
    }
    @keyframes gunterFlipperShake {
        0%, 100% { transform: rotate(-15deg) translateY(0); transform-origin: 22px 50px; }
        50%      { transform: rotate(-20deg) translateY(-2px); transform-origin: 22px 50px; }
    }
    @keyframes gunterWaveFlipper {
        0%   { transform: rotate(15deg); transform-origin: 78px 50px; }
        30%  { transform: rotate(-50deg); transform-origin: 78px 50px; }
        50%  { transform: rotate(-10deg); transform-origin: 78px 50px; }
        70%  { transform: rotate(-50deg); transform-origin: 78px 50px; }
        100% { transform: rotate(15deg); transform-origin: 78px 50px; }
    }
    @keyframes gunterApplaudL {
        0%, 100% { transform: rotate(-15deg) translateX(0); transform-origin: 22px 50px; }
        50%      { transform: rotate(-35deg) translateX(8px); transform-origin: 22px 50px; }
    }
    @keyframes gunterApplaudR {
        0%, 100% { transform: rotate(15deg) translateX(0); transform-origin: 78px 50px; }
        50%      { transform: rotate(35deg) translateX(-8px); transform-origin: 78px 50px; }
    }
`;
document.head.appendChild(gunterStyles);

// Export
window.GunterAvatar = GunterAvatar;
