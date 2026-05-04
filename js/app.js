/* =============================================
   GUNTER APP - Main JavaScript
   ============================================= */

// ===== DOM READY =====
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

// ===== INITIALIZATION =====
function initApp() {
  // Initialize page-specific features
  initLoginTabs();
  initPasswordToggle();
  initFormValidation();
  initToasts();
}

// ===== LOGIN TABS =====
function initLoginTabs() {
  const tabs = document.querySelectorAll('.login-tab');
  const panels = document.querySelectorAll('.login-panel');
  
  if (!tabs.length) return;
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetPanel = tab.dataset.tab;
      
      // Update tabs
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update panels
      panels.forEach(p => p.classList.remove('active'));
      document.getElementById(`${targetPanel}-panel`)?.classList.add('active');
    });
  });
}

// ===== PASSWORD TOGGLE =====
function initPasswordToggle() {
  const toggles = document.querySelectorAll('.password-toggle');
  
  toggles.forEach(toggle => {
    toggle.addEventListener('click', () => {
      const wrapper = toggle.closest('.password-wrapper');
      const input = wrapper.querySelector('input');
      
      if (input.type === 'password') {
        input.type = 'text';
        toggle.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        `;
      } else {
        input.type = 'password';
        toggle.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        `;
      }
    });
  });
}

// ===== FORM VALIDATION =====
function initFormValidation() {
  // Login Form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleLogin(loginForm);
    });
  }
  
  // Register Form
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleRegister(registerForm);
    });
  }
}

// ===== LOGIN HANDLER =====
function handleLogin(form) {
  const email = form.querySelector('#login-email').value;
  const password = form.querySelector('#login-password').value;
  const statusEl = document.getElementById('login-status');
  
  // Simple validation
  if (!email || !password) {
    showStatus(statusEl, 'Por favor completa todos los campos', 'error');
    return;
  }
  
  // Simulate login (in real app, this would be an API call)
  showStatus(statusEl, 'Iniciando sesión...', 'success');
  
  setTimeout(() => {
    // Store user info
    localStorage.setItem('gunter_user', JSON.stringify({
      email: email,
      name: email.split('@')[0]
    }));
    
    // Redirect to dashboard
    window.location.href = 'dashboard.html';
  }, 1000);
}

// ===== REGISTER HANDLER =====
function handleRegister(form) {
  const name = form.querySelector('#register-name').value;
  const email = form.querySelector('#register-email').value;
  const password = form.querySelector('#register-password').value;
  const terms = form.querySelector('#terms').checked;
  const statusEl = document.getElementById('login-status');
  
  // Validation
  if (!name || !email || !password) {
    showStatus(statusEl, 'Por favor completa todos los campos', 'error');
    return;
  }
  
  if (!terms) {
    showStatus(statusEl, 'Debes aceptar los términos y condiciones', 'error');
    return;
  }
  
  if (password.length < 8) {
    showStatus(statusEl, 'La contraseña debe tener al menos 8 caracteres', 'error');
    return;
  }
  
  // Simulate registration
  showStatus(statusEl, 'Creando cuenta...', 'success');
  
  setTimeout(() => {
    // Store user info
    localStorage.setItem('gunter_user', JSON.stringify({
      email: email,
      name: name
    }));
    
    // Redirect to dashboard
    window.location.href = 'dashboard.html';
  }, 1000);
}

// ===== STATUS HELPER =====
function showStatus(element, message, type) {
  if (!element) return;
  
  element.textContent = message;
  element.className = 'login-status ' + type;
}

// ===== TOAST NOTIFICATIONS =====
function initToasts() {
  // Create toast container if it doesn't exist
  if (!document.querySelector('.toast-container')) {
    const container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
}

/**
 * @deprecated Fase B (2026-04). Usa window.GunterNotificationsService.showToast(msg, opts).
 * Esta implementación queda como API zombie (cero callers reales en el repo).
 * Razón: cuando se migre a la API oficial, eliminar esta función + initToasts() + getToastIcon()
 * + estilos `.toast-container` + `.toast--{type}` (no romper nada porque no hay callers).
 *
 * Si por alguna razón llega aquí, intenta delegar al servicio oficial.
 */
function showToast(message, type = 'info') {
  // Intentar delegar al servicio oficial si está disponible (migración soft, sin tocar visual de callers nuevos)
  if (window.GunterNotificationsService?.showToast) {
    const variantMap = { success: 'success', warning: 'warn', error: 'error', info: 'info' };
    return window.GunterNotificationsService.showToast(message, {
      variant: variantMap[type] || 'info',
      silent: true   // no hablar por TTS desde callers legacy
    });
  }

  // Fallback: implementación legacy (solo si el container existe; si no, lo creamos)
  let container = document.querySelector('.toast-container');
  if (!container) {
    initToasts();
    container = document.querySelector('.toast-container');
  }
  if (!container) return;   // safety: nunca crash

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span>${getToastIcon(type)}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Auto remove after 5 seconds
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function getToastIcon(type) {
  const icons = {
    success: '✓',
    warning: '⚠',
    error: '✕',
    info: 'ℹ'
  };
  return icons[type] || icons.info;
}

// ===== AVATAR STATE MANAGER =====
class GunterAvatar {
  constructor(element) {
    this.element = element;
    this.states = {
      default: 'assets/gunter/gunter_default_1769130911628.png',
      listening: 'assets/gunter/gunter_listening_1769131008264.png',
      analyzing: 'assets/gunter/gunter_analyzing_1769131035783.png',
      alert: 'assets/gunter/gunter_alert_1769131090250.png',
      celebration: 'assets/gunter/gunter_celebration_1769131151470.png'
    };
    this.currentState = 'default';
  }
  
  setState(state) {
    if (this.states[state] && state !== this.currentState) {
      this.currentState = state;
      const container = this.element.closest('.gunter-avatar');
      
      if (container) {
        container.dataset.state = state;
      }
      
      // Update image with fade
      this.element.style.opacity = '0';
      setTimeout(() => {
        this.element.src = this.states[state];
        this.element.style.opacity = '1';
      }, 200);
      
      // Update state text if exists
      const stateText = document.getElementById('gunter-state-text');
      if (stateText) {
        stateText.textContent = state.toUpperCase();
      }
    }
  }
}

// ===== UTILITY FUNCTIONS =====

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Format time from seconds
function formatTime(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Export for use in other scripts
window.GunterApp = {
  showToast,
  GunterAvatar,
  debounce,
  formatTime
};
