/* =============================================
   GUNTER APP - Theme Manager Module
   Dynamic Theme Switching
   ============================================= */

class GunterThemeManager {
    constructor() {
        this.currentTheme = localStorage.getItem('gunter_theme') || this.detectSystemPreference();
        this.darkMode = localStorage.getItem('gunter_dark_mode') === 'true';
        this.themeStylesheet = null;
        this.transitionDuration = 300; // ms
        this.avatarImages = {
            default: 'assets/gunter/gunter_transparent_default_1769134184933.png',
            listening: 'assets/gunter/gunter_transparent_listening_1769134210443.png',
            analyzing: 'assets/gunter/gunter_transparent_analyzing_1769134251133.png',
            alert: 'assets/gunter/gunter_transparent_alert_1769134280215.png',
            celebration: 'assets/gunter/gunter_transparent_celebration_1769134301694.png'
        };
    }

    // Initialize theme on page load
    init() {
        // THEME SCOPING: el tema visual de proyecto (empresarial/artistico/podcast/zen)
        // solo aplica en páginas del producto "Gunter Reuniones". El producto
        // "Gunter Día" usa su propia estética neutra independiente.
        if (!GunterThemeManager.isThemedPage()) {
            // Limpiar cualquier atributo data-theme previo para que los estilos
            // de tema no filtren al día/hub.
            document.documentElement.removeAttribute('data-theme');
            return;
        }
        this.loadTheme(this.currentTheme);
        this.setupThemeFromProject();
        this.applyDarkMode(this.darkMode);
        this.setupSystemPreferenceListener();
    }

    // Páginas donde el tema SÍ aplica (flujo de reunión)
    static isThemedPage() {
        const p = (location.pathname || '').toLowerCase();
        return /meeting\.html$|results\.html$|new-project\.html$/.test(p);
    }

    // Load theme from project settings
    setupThemeFromProject() {
        const projectEnv = localStorage.getItem('gunter_env');
        if (projectEnv) {
            this.setTheme(projectEnv);
        }
    }

    // Set theme with smooth transition
    setTheme(themeName) {
        const validThemes = ['empresarial', 'artistico', 'podcast', 'zen'];
        if (!validThemes.includes(themeName)) {
            themeName = 'empresarial';
        }

        // Guardar la selección siempre (para que al entrar a meeting/results se recupere)
        this.currentTheme = themeName;
        localStorage.setItem('gunter_theme', themeName);
        localStorage.setItem('gunter_env', themeName);

        // Si NO estamos en una página temática, no tocamos el DOM/CSS — solo
        // persistimos. Así el selector del wizard puede cambiar `gunter_env`
        // sin pintar dashboard ni día.
        if (!GunterThemeManager.isThemedPage()) {
            window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: themeName } }));
            return;
        }

        // Enable transitions
        this.enableTransitions();

        // Apply theme to document
        document.documentElement.setAttribute('data-theme', themeName);

        // Load theme stylesheet dynamically
        this.loadTheme(themeName);

        // Disable transitions after animation
        setTimeout(() => this.disableTransitions(), this.transitionDuration);

        // Dispatch event for other components
        window.dispatchEvent(new CustomEvent('themechange', {
            detail: { theme: themeName }
        }));
    }

    // Load theme CSS file
    loadTheme(themeName) {
        // Remove existing theme stylesheet
        if (this.themeStylesheet) {
            this.themeStylesheet.remove();
        }

        // Ensure shared refinements (only once, before theme)
        if (!document.getElementById('theme-shared-stylesheet')) {
            const shared = document.createElement('link');
            shared.rel = 'stylesheet';
            shared.href = 'styles/themes/_shared.css';
            shared.id = 'theme-shared-stylesheet';
            document.head.appendChild(shared);
        }
        if (!document.getElementById('theme-unique-stylesheet')) {
            const uniq = document.createElement('link');
            uniq.rel = 'stylesheet';
            uniq.href = 'styles/themes/_unique-structures.css';
            uniq.id = 'theme-unique-stylesheet';
            document.head.appendChild(uniq);
        }

        // Create and append new theme stylesheet
        this.themeStylesheet = document.createElement('link');
        this.themeStylesheet.rel = 'stylesheet';
        this.themeStylesheet.href = `styles/themes/${themeName}.css`;
        this.themeStylesheet.id = 'theme-stylesheet';
        document.head.appendChild(this.themeStylesheet);

        // Set data attribute on body
        document.documentElement.setAttribute('data-theme', themeName);
    }

    // Get current theme
    getTheme() {
        return this.currentTheme;
    }

    // Get theme display info
    getThemeInfo(themeName = this.currentTheme) {
        const themes = {
            empresarial: {
                name: 'Empresarial',
                icon: '🏢',
                description: 'Corporate Sleek - Frío y profesional',
                colors: {
                    primary: '#00d4ff',
                    secondary: '#4a9eff',
                    bg: '#0a0f1c'
                }
            },
            artistico: {
                name: 'Artístico',
                icon: '🎨',
                description: 'Digital Avant-garde - Expresivo y vibrante',
                colors: {
                    primary: '#ff006e',
                    secondary: '#00ffff',
                    bg: '#0f0515'
                }
            },
            podcast: {
                name: 'Podcast',
                icon: '🎙️',
                description: 'Studio Lo-Fi - Cálido y relajado',
                colors: {
                    primary: '#ffaa00',
                    secondary: '#9b59b6',
                    bg: '#12100f'
                }
            }
        };

        return themes[themeName] || themes.empresarial;
    }

    // Get avatar for current state
    getAvatarSrc(state = 'default') {
        return this.avatarImages[state] || this.avatarImages.default;
    }

    // Update all avatars on page
    updateAvatars(state = 'default') {
        const avatars = document.querySelectorAll('.gunter-avatar-img, .gunter-insights__avatar');
        const src = this.getAvatarSrc(state);

        avatars.forEach(img => {
            img.src = src;
        });
    }

    // Detect system color scheme preference
    detectSystemPreference() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'empresarial'; // Default dark theme
        }
        return 'empresarial';
    }

    // Setup listener for system preference changes
    setupSystemPreferenceListener() {
        if (window.matchMedia) {
            const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
            darkModeQuery.addEventListener('change', (e) => {
                if (!localStorage.getItem('gunter_dark_mode')) {
                    this.toggleDarkMode(e.matches);
                }
            });
        }
    }

    // Toggle dark mode
    toggleDarkMode(enabled = !this.darkMode) {
        this.enableTransitions();
        this.darkMode = enabled;
        localStorage.setItem('gunter_dark_mode', enabled);
        this.applyDarkMode(enabled);
        setTimeout(() => this.disableTransitions(), this.transitionDuration);
    }

    // Apply dark mode
    applyDarkMode(enabled) {
        if (enabled) {
            document.documentElement.classList.add('dark-mode');
        } else {
            document.documentElement.classList.remove('dark-mode');
        }
    }

    // Enable smooth transitions
    enableTransitions() {
        document.documentElement.classList.add('theme-transitioning');
    }

    // Disable transitions
    disableTransitions() {
        document.documentElement.classList.remove('theme-transitioning');
    }

    // Get dark mode status
    isDarkMode() {
        return this.darkMode;
    }
}

// Create global instance
window.GunterTheme = new GunterThemeManager();

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.GunterTheme.init();
});
