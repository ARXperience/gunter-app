/* =============================================
   GUNTER APP - Particle Effects System
   Neural network, gradient mesh, starfield
   ============================================= */

class GunterParticleSystem {
    constructor(options = {}) {
        this.canvas = null;
        this.ctx = null;
        this.particles = [];
        this.animationId = null;
        this.mouse = { x: null, y: null };

        // Configuration
        this.config = {
            particleCount: options.particleCount || 80,
            particleSize: options.particleSize || 2,
            connectionDistance: options.connectionDistance || 150,
            particleSpeed: options.particleSpeed || 0.5,
            mouseRadius: options.mouseRadius || 200,
            theme: options.theme || 'empresarial',
            type: options.type || 'neural', // 'neural', 'gradient', 'starfield'
            ...options
        };

        this.colors = this.getThemeColors(this.config.theme);
    }

    /**
     * Get colors based on theme
     */
    getThemeColors(theme) {
        const themes = {
            empresarial: {
                primary: 'rgba(0, 212, 255, ',
                secondary: 'rgba(74, 158, 255, ',
                particle: 'rgba(0, 212, 255, 0.6)'
            },
            artistico: {
                primary: 'rgba(255, 0, 110, ',
                secondary: 'rgba(0, 255, 255, ',
                particle: 'rgba(255, 0, 110, 0.6)'
            },
            podcast: {
                primary: 'rgba(255, 170, 0, ',
                secondary: 'rgba(155, 89, 182, ',
                particle: 'rgba(255, 170, 0, 0.6)'
            }
        };

        return themes[theme] || themes.empresarial;
    }

    /**
     * Initialize particle system
     */
    init(canvasId = 'particle-canvas') {
        // Create or get canvas
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.canvas.id = canvasId;
            this.canvas.style.position = 'fixed';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.pointerEvents = 'none';
            this.canvas.style.zIndex = '0';
            document.body.prepend(this.canvas);
        }

        this.ctx = this.canvas.getContext('2d');
        this.resize();

        // Create particles
        this.createParticles();

        // Event listeners
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));

        // Start animation
        this.animate();
    }

    /**
     * Resize canvas
     */
    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    /**
     * Handle mouse movement
     */
    handleMouseMove(e) {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
    }

    /**
     * Create particles
     */
    createParticles() {
        this.particles = [];

        for (let i = 0; i < this.config.particleCount; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * this.config.particleSpeed,
                vy: (Math.random() - 0.5) * this.config.particleSpeed,
                size: Math.random() * this.config.particleSize + 1,
                opacity: Math.random() * 0.5 + 0.3
            });
        }
    }

    /**
     * Update particles
     */
    updateParticles() {
        this.particles.forEach(particle => {
            // Move particle
            particle.x += particle.vx;
            particle.y += particle.vy;

            // Bounce off edges
            if (particle.x < 0 || particle.x > this.canvas.width) {
                particle.vx *= -1;
            }
            if (particle.y < 0 || particle.y > this.canvas.height) {
                particle.vy *= -1;
            }

            // Mouse interaction
            if (this.mouse.x !== null && this.mouse.y !== null) {
                const dx = this.mouse.x - particle.x;
                const dy = this.mouse.y - particle.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < this.config.mouseRadius) {
                    const force = (this.config.mouseRadius - distance) / this.config.mouseRadius;
                    particle.vx -= (dx / distance) * force * 0.1;
                    particle.vy -= (dy / distance) * force * 0.1;
                }
            }

            // Limit velocity
            const maxSpeed = this.config.particleSpeed * 2;
            const speed = Math.sqrt(particle.vx * particle.vx + particle.vy * particle.vy);
            if (speed > maxSpeed) {
                particle.vx = (particle.vx / speed) * maxSpeed;
                particle.vy = (particle.vy / speed) * maxSpeed;
            }
        });
    }

    /**
     * Draw particles
     */
    drawParticles() {
        this.particles.forEach(particle => {
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            this.ctx.fillStyle = this.colors.particle;
            this.ctx.fill();
        });
    }

    /**
     * Draw connections
     */
    drawConnections() {
        for (let i = 0; i < this.particles.length; i++) {
            for (let j = i + 1; j < this.particles.length; j++) {
                const dx = this.particles[i].x - this.particles[j].x;
                const dy = this.particles[i].y - this.particles[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < this.config.connectionDistance) {
                    const opacity = 1 - (distance / this.config.connectionDistance);
                    this.ctx.beginPath();
                    this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
                    this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
                    this.ctx.strokeStyle = this.colors.primary + (opacity * 0.2) + ')';
                    this.ctx.lineWidth = 1;
                    this.ctx.stroke();
                }
            }
        }
    }

    /**
     * Animation loop
     */
    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.config.type === 'neural') {
            this.updateParticles();
            this.drawConnections();
            this.drawParticles();
        } else if (this.config.type === 'starfield') {
            this.animateStarfield();
        } else if (this.config.type === 'gradient') {
            this.animateGradientMesh();
        }

        this.animationId = requestAnimationFrame(() => this.animate());
    }

    /**
     * Starfield animation
     */
    animateStarfield() {
        this.particles.forEach(particle => {
            // Move towards viewer
            particle.z = particle.z || Math.random() * this.canvas.width;
            particle.z -= 2;

            if (particle.z <= 0) {
                particle.z = this.canvas.width;
                particle.x = Math.random() * this.canvas.width;
                particle.y = Math.random() * this.canvas.height;
            }

            // Calculate position
            const k = 128.0 / particle.z;
            const px = (particle.x - this.canvas.width / 2) * k + this.canvas.width / 2;
            const py = (particle.y - this.canvas.height / 2) * k + this.canvas.height / 2;

            // Draw star
            const size = (1 - particle.z / this.canvas.width) * 3;
            const opacity = (1 - particle.z / this.canvas.width) * 0.8;

            this.ctx.beginPath();
            this.ctx.arc(px, py, size, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
            this.ctx.fill();
        });
    }

    /**
     * Gradient mesh animation
     */
    animateGradientMesh() {
        const time = Date.now() * 0.001;

        // Create animated gradient
        const gradient = this.ctx.createRadialGradient(
            this.canvas.width / 2 + Math.sin(time) * 100,
            this.canvas.height / 2 + Math.cos(time) * 100,
            0,
            this.canvas.width / 2,
            this.canvas.height / 2,
            this.canvas.width / 2
        );

        gradient.addColorStop(0, this.colors.primary + '0.1)');
        gradient.addColorStop(0.5, this.colors.secondary + '0.05)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Change theme
     */
    setTheme(theme) {
        this.config.theme = theme;
        this.colors = this.getThemeColors(theme);
    }

    /**
     * Change particle type
     */
    setType(type) {
        this.config.type = type;
        if (type === 'starfield') {
            this.createParticles();
        }
    }

    /**
     * Stop animation
     */
    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    /**
     * Destroy particle system
     */
    destroy() {
        this.stop();
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        window.removeEventListener('resize', () => this.resize());
        window.removeEventListener('mousemove', (e) => this.handleMouseMove(e));
    }
}

// Export
window.GunterParticleSystem = GunterParticleSystem;

// Auto-initialize based on page
document.addEventListener('DOMContentLoaded', () => {
    // Check if particles should be enabled
    const enableParticles = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (enableParticles) {
        const theme = localStorage.getItem('gunter_theme') || 'empresarial';
        const particleSystem = new GunterParticleSystem({
            theme: theme,
            type: 'neural',
            particleCount: 60,
            connectionDistance: 150
        });

        particleSystem.init();

        // Listen for theme changes
        window.addEventListener('themechange', (e) => {
            particleSystem.setTheme(e.detail.theme);
        });

        // Store globally
        window.gunterParticles = particleSystem;
    }
});
