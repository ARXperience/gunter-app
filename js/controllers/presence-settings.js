(function () {
    function mount() {
        const service = window.GunterPresence;
        const city = document.getElementById('pref-city');
        const timezone = document.getElementById('pref-timezone');
        const greeting = document.getElementById('pref-entry-greeting');
        const locationButton = document.getElementById('pref-use-location');
        const status = document.getElementById('pref-location-status');
        if (!service || !city) return;
        const prefs = service.preferences();
        city.value = prefs.city || '';
        timezone.value = prefs.timezone || service.timezone();
        greeting.checked = prefs.entryGreeting !== false;
        city.addEventListener('change', () => service.savePreferences({ city: city.value.trim().slice(0, 100), locationSource: 'manual', useDeviceLocation: false }));
        greeting.addEventListener('change', () => service.savePreferences({ entryGreeting: greeting.checked }));
        timezone.addEventListener('change', () => {
            try { new Intl.DateTimeFormat('es', { timeZone: timezone.value }).format(); service.savePreferences({ timezone: timezone.value }); status.textContent = 'Zona horaria guardada.'; }
            catch { status.textContent = 'Escribe una zona válida, por ejemplo America/Bogota.'; }
        });
        locationButton.addEventListener('click', async () => {
            locationButton.disabled = true; status.textContent = 'Consultando tu ciudad…';
            try { const result = await service.useLocation(); city.value = result.city; status.textContent = 'Ciudad confirmada: ' + result.city; }
            catch { status.textContent = 'No pude confirmar tu ubicación. Revisa el permiso del sitio o escribe tu ciudad.'; }
            finally { locationButton.disabled = false; }
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
