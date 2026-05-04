/* =============================================
   GUNTER APP - Presentation Mode
   Fullscreen presentation with auto-scroll
   ============================================= */

class GunterPresentationMode {
    constructor() {
        this.isActive = false;
        this.currentSection = 0;
        this.sections = [];
        this.container = null;
        this.controls = null;
    }

    /**
     * Initialize presentation mode
     */
    init(containerId = 'results-content') {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error('Presentation container not found');
            return;
        }

        // Find all sections
        this.sections = Array.from(this.container.querySelectorAll('section, .analysis-section'));

        // Create controls
        this.createControls();

        // Add keyboard listeners
        this.setupKeyboardNavigation();
    }

    /**
     * Create presentation controls
     */
    createControls() {
        const controls = document.createElement('div');
        controls.className = 'presentation-controls';
        controls.innerHTML = `
            <button class="presentation-btn presentation-prev" title="Previous (←)">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button>
            <div class="presentation-progress">
                <span class="presentation-current">1</span> / <span class="presentation-total">${this.sections.length}</span>
            </div>
            <button class="presentation-btn presentation-next" title="Next (→)">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
            <button class="presentation-btn presentation-exit" title="Exit (Esc)">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `;

        document.body.appendChild(controls);
        this.controls = controls;

        // Add event listeners
        controls.querySelector('.presentation-prev').addEventListener('click', () => this.previousSection());
        controls.querySelector('.presentation-next').addEventListener('click', () => this.nextSection());
        controls.querySelector('.presentation-exit').addEventListener('click', () => this.exit());
    }

    /**
     * Setup keyboard navigation
     */
    setupKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            if (!this.isActive) return;

            switch (e.key) {
                case 'ArrowRight':
                case ' ':
                case 'PageDown':
                    e.preventDefault();
                    this.nextSection();
                    break;
                case 'ArrowLeft':
                case 'PageUp':
                    e.preventDefault();
                    this.previousSection();
                    break;
                case 'Escape':
                    e.preventDefault();
                    this.exit();
                    break;
                case 'Home':
                    e.preventDefault();
                    this.goToSection(0);
                    break;
                case 'End':
                    e.preventDefault();
                    this.goToSection(this.sections.length - 1);
                    break;
            }
        });
    }

    /**
     * Enter presentation mode
     */
    async enter() {
        if (this.isActive) return;

        this.isActive = true;

        // Request fullscreen
        try {
            if (document.documentElement.requestFullscreen) {
                await document.documentElement.requestFullscreen();
            }
        } catch (err) {
            console.warn('Fullscreen not available:', err);
        }

        // Add presentation class
        document.body.classList.add('presentation-mode');

        // Show controls
        if (this.controls) {
            this.controls.style.display = 'flex';
        }

        // Go to first section
        this.goToSection(0);
    }

    /**
     * Exit presentation mode
     */
    async exit() {
        if (!this.isActive) return;

        this.isActive = false;

        // Exit fullscreen
        try {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            }
        } catch (err) {
            console.warn('Error exiting fullscreen:', err);
        }

        // Remove presentation class
        document.body.classList.remove('presentation-mode');

        // Hide controls
        if (this.controls) {
            this.controls.style.display = 'none';
        }

        // Reset sections
        this.sections.forEach(section => {
            section.classList.remove('presentation-active');
        });
    }

    /**
     * Go to specific section
     */
    goToSection(index) {
        if (index < 0 || index >= this.sections.length) return;

        // Remove active class from all sections
        this.sections.forEach(section => {
            section.classList.remove('presentation-active');
        });

        // Add active class to current section
        this.sections[index].classList.add('presentation-active');

        // Scroll to section
        this.sections[index].scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Update current section
        this.currentSection = index;

        // Update progress
        this.updateProgress();
    }

    /**
     * Next section
     */
    nextSection() {
        if (this.currentSection < this.sections.length - 1) {
            this.goToSection(this.currentSection + 1);
        }
    }

    /**
     * Previous section
     */
    previousSection() {
        if (this.currentSection > 0) {
            this.goToSection(this.currentSection - 1);
        }
    }

    /**
     * Update progress indicator
     */
    updateProgress() {
        if (!this.controls) return;

        const current = this.controls.querySelector('.presentation-current');
        const total = this.controls.querySelector('.presentation-total');

        if (current) current.textContent = this.currentSection + 1;
        if (total) total.textContent = this.sections.length;
    }

    /**
     * Auto-play presentation
     */
    autoPlay(interval = 5000) {
        if (this.autoPlayInterval) {
            clearInterval(this.autoPlayInterval);
        }

        this.autoPlayInterval = setInterval(() => {
            if (this.currentSection < this.sections.length - 1) {
                this.nextSection();
            } else {
                this.stopAutoPlay();
            }
        }, interval);
    }

    /**
     * Stop auto-play
     */
    stopAutoPlay() {
        if (this.autoPlayInterval) {
            clearInterval(this.autoPlayInterval);
            this.autoPlayInterval = null;
        }
    }

    /**
     * Toggle presentation mode
     */
    toggle() {
        if (this.isActive) {
            this.exit();
        } else {
            this.enter();
        }
    }
}

// Export
window.GunterPresentationMode = GunterPresentationMode;

// Auto-initialize
document.addEventListener('DOMContentLoaded', () => {
    window.gunterPresentation = new GunterPresentationMode();
    window.gunterPresentation.init();
});
