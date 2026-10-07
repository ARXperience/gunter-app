const { test, expect } = require('@playwright/test');

test('alta real, captura y persistencia de tarea, ajustes accesibles y viewport móvil', async ({ page }) => {
    const uncaught = [];
    page.on('pageerror', error => { uncaught.push(error.message); console.error('App page error:', error.message); });

    await page.goto('/login.html');
    await expect(page.locator('#glogin-form-register')).toBeVisible();
    const username = `e2e_${Date.now()}`;
    const password = 'ClaveTemporal-927!';
    await page.locator('#gr-name').fill('Prueba E2E');
    await page.locator('#gr-user').fill(username);
    await page.locator('#gr-email').fill('');
    await page.locator('#gr-pass').fill(password);
    await page.locator('#gr-pass2').fill(password);
    await page.locator('#gr-submit').click();
    await expect(page).toHaveURL(/day\.html/);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('gunter_companion_log') || '[]').some(item => /Prueba E2E/.test(item.text)));
    // Allow the authenticated entry (including the first SW activation) to finish.
    await page.waitForLoadState('load');
    await expect(page.locator('#gday-quickbar-input')).toBeVisible();
    await page.waitForFunction(() => !!window.GunterDayController && !!window.GunterPipeline);
    const hybrid = await page.evaluate(async () => {
        const initial = await (await fetch('/api/control/hybrid/status')).json();
        const changed = await (await fetch('/api/control/hybrid/mode', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'LOCAL', privacy: 'LOCAL_ONLY' }) })).json();
        const blocked = {};
        for (const endpoint of ['chat', 'transcribe', 'tts', 'embeddings', 'gemini-text']) {
            const response = await fetch(`/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [{ role: 'user', content: 'prueba' }] }) });
            blocked[endpoint] = { status: response.status, body: await response.json() };
        }
        const restored = await (await fetch('/api/control/hybrid/mode', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'AUTO', privacy: 'STANDARD' }) })).json();
        const runtime = await window.GunterRuntimeState.refresh();
        const cloudResponse = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'prueba' }] }) });
        const cloudBody = await cloudResponse.json();
        return { initial, changed, blocked, restored, cloudBody, runtime };
    });
    expect(hybrid.initial.data.mode).toBe('AUTO');
    expect(hybrid.changed.success).toBe(true);
    for (const [endpoint, result] of Object.entries(hybrid.blocked)) {
        expect(result.status).toBe(503);
        expect(result.body.code).toBe(endpoint === 'transcribe' ? 'LOCAL_STT_NOT_INSTALLED' : 'LOCAL_PROVIDER_NOT_INSTALLED');
    }
    expect(hybrid.restored.data.mode).toBe('AUTO');
    expect(hybrid.cloudBody.code).not.toBe('LOCAL_PROVIDER_NOT_INSTALLED');
    expect(hybrid.runtime.mode).toBe('AUTO');
    expect(hybrid.runtime.localBrainAvailable).toBe(false);
    expect(hybrid.runtime.localSTTAvailable).toBe(false);
    expect(hybrid.runtime.localTTSAvailable).toBe(false);
    expect(hybrid.runtime.backendAvailable).toBe(true);
    const greetings = await page.evaluate(() => JSON.parse(localStorage.getItem('gunter_companion_log') || '[]').filter(item => /Prueba E2E/.test(item.text)).map(item => item.text));
    expect(greetings).toHaveLength(1);
    expect(greetings[0]).toMatch(/Buen(?:os días|as tardes|as noches).*Prueba E2E.*Son las/);

    // Use the actual capture form and browser persistence, not a mocked service.
    const taskTitle = `E2E verificar flujo ${Date.now()}`;
    await page.locator('#gday-quickbar-input').fill(`Crea una tarea para ${taskTitle}`);
    await page.locator('#gday-quickbar-form button[type="submit"]').click();
    await expect(page.locator('#gday-quickbar-input')).toHaveValue('', { timeout: 35_000 });
    await expect(page.locator('#gday-tasks-mount')).toContainText(taskTitle, { timeout: 15_000 }).catch(async error => {
        console.log('Task flow diagnostics:', await page.evaluate(async () => ({ conversation: JSON.parse(localStorage.getItem('gunter_conversation') || '[]').slice(-2), traces: window.GunterTraceLogger?.getAll?.().slice?.(-1), tasks: await window.GunterTasksService.list() })));
        throw error;
    });

    // Reload to verify IndexedDB persistence, then complete it via the rendered control.
    await page.reload();
    await expect(page.locator('#gday-tasks-mount')).toContainText(taskTitle);
    const tile = page.locator('.gn-tile').filter({ hasText: taskTitle });
    await tile.locator('[data-task-toggle]').click();
    await expect.poll(async () => page.evaluate(async title => {
        const tasks = await window.GunterTasksService.list();
        return tasks.find(task => task.title.includes(title))?.status;
    }, taskTitle), { timeout: 15_000 }).toBe('done');

    await page.goto('/config.html#preferences');
    await page.locator('#config-tab-premium').click();
    await expect(page.locator('#cp-hybrid-mode')).toBeVisible();
    await expect(page.locator('#cp-hybrid-mode option[value="LOCAL"]')).toHaveAttribute('disabled', '');
    await page.locator('#cp-hybrid-mode').selectOption('CLOUD');
    await page.locator('#cp-hybrid-save').click();
    await expect.poll(async () => (await (await page.request.get('/api/control/hybrid/status')).json()).data.mode).toBe('CLOUD');
    await page.locator('#cp-hybrid-mode').selectOption('AUTO');
    await page.locator('#cp-hybrid-save').click();
    await expect.poll(async () => (await (await page.request.get('/api/control/hybrid/status')).json()).data.mode).toBe('AUTO');
    await page.locator('#config-tab-preferences').click();
    await page.locator('#pref-city').fill('Cali');
    await page.locator('#pref-city').press('Tab');
    await page.locator('#pref-timezone').fill('America/Bogota');
    await page.locator('#pref-timezone').press('Tab');
    await page.locator('#pref-language').selectOption('es-MX');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gunter_prefs')).city)).toBe('Cali');
    await page.evaluate(() => window.GunterCompanion.__handleFromWake('desactiva el saludo al entrar'));
    await expect(page.locator('#pref-entry-greeting')).toBeChecked();
    await page.evaluate(() => window.GunterCompanion.__handleFromWake('sí'));
    await expect(page.locator('#pref-entry-greeting')).toBeChecked();
    await page.evaluate(() => window.GunterAssistantTools.dispatch('sí', { inputSource: 'text' }));
    await expect(page.locator('#pref-entry-greeting')).not.toBeChecked();
    await page.evaluate(() => window.GunterCompanion.__handleFromWake('activa el saludo al entrar'));
    await expect(page.locator('#pref-entry-greeting')).not.toBeChecked();
    await page.evaluate(() => window.GunterAssistantTools.dispatch('sí', { inputSource: 'text' }));
    await expect(page.locator('#pref-entry-greeting')).toBeChecked();
    const preferencesTab = page.locator('#config-tab-preferences');
    await expect(preferencesTab).toBeVisible();
    await preferencesTab.press('ArrowRight');
    await expect(page.locator('#config-tab-data')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#config-panel-data')).toBeVisible();
    await expect(page.locator('#status-fcm')).not.toContainText('Servidor no responde');
    await expect(page.locator('#status-apns')).not.toContainText('Servidor no responde');

    // Verify the login path too, not only first-account registration.
    await page.evaluate(async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        sessionStorage.removeItem('gunter_auth_user');
    });
    await page.goto('/login.html');
    await expect(page.locator('#glogin-form-login')).toBeVisible();
    await page.locator('#gl-user').fill(username);
    await page.locator('#gl-pass').fill(password);
    await page.locator('#gl-submit').click();
    await expect(page).toHaveURL(/day\.html/);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('gunter_companion_log') || '[]').some(item => /ciudad configurada es Cali/.test(item.text)));
    const latestGreeting = await page.evaluate(() => JSON.parse(localStorage.getItem('gunter_companion_log') || '[]').filter(item => /Prueba E2E/.test(item.text)).at(-1)?.text);
    expect(latestGreeting).not.toBe(greetings[0]);

    // A provider can finish after cancellation: the old reply must stay silent
    // and never be appended after the user's newer turn.
    await page.evaluate(() => {
        window.__originalComplete = window.GunterNlpLlm.complete;
        let calls = 0;
        window.GunterNlpLlm.complete = (prompt, options) => {
            calls++;
            if (calls === 1) { window.__oldSignal = options.signal; return new Promise(resolve => { window.__resolveOld = resolve; }); }
            return Promise.resolve('Respuesta actual de prueba.');
        };
        window.__oldTurn = window.GunterCompanion.__handleFromWake('Hablemos del universo');
    });
    await page.waitForFunction(() => typeof window.__resolveOld === 'function');
    await page.evaluate(async () => {
        await window.GunterCompanion.__handleFromWake('Hablemos del océano');
        window.__resolveOld('Respuesta antigua que no debe aparecer.');
        await window.__oldTurn;
        window.GunterNlpLlm.complete = window.__originalComplete;
    });
    expect(await page.evaluate(() => window.__oldSignal.aborted)).toBe(true);
    const turnLog = await page.evaluate(() => JSON.parse(localStorage.getItem('gunter_companion_log') || '[]').map(item => item.text).join('\n'));
    expect(turnLog).toContain('Respuesta actual de prueba.');
    expect(turnLog).not.toContain('Respuesta antigua que no debe aparecer.');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/day.html');
    await page.locator('button[aria-label="Más opciones"]').click();
    await page.locator('.gunter-command-nav__mobile-panel a[href="day.html#capture"]').click();
    await expect(page.locator('#gday-quickbar-input')).toBeVisible();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(horizontalOverflow, 'mobile layout should not overflow horizontally').toBe(false);
    expect(uncaught, 'the browser should not emit uncaught JavaScript exceptions').toEqual([]);
});
