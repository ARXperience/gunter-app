const { test, expect } = require('@playwright/test');

test('alta real, captura y persistencia de tarea, ajustes accesibles y viewport móvil', async ({ page }) => {
    const uncaught = [];
    page.on('pageerror', error => uncaught.push(error.message));

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
    // Load the protected page after auth completes so all deferred controllers
    // have a complete lifecycle before interacting with its capture form.
    await page.goto('/day.html');
    await expect(page.locator('#gday-quickbar-input')).toBeVisible();
    await page.waitForFunction(() => !!window.GunterDayController && !!window.GunterPipeline);

    // Use the actual capture form and browser persistence, not a mocked service.
    const taskTitle = `E2E verificar flujo ${Date.now()}`;
    await page.locator('#gday-quickbar-input').fill(`Crea una tarea para ${taskTitle}`);
    await page.locator('#gday-quickbar-form button[type="submit"]').click();
    await expect(page.locator('#gday-quickbar-input')).toHaveValue('', { timeout: 35_000 });
    await expect(page.locator('#gday-tasks-mount')).toContainText(taskTitle, { timeout: 15_000 });

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
    const preferencesTab = page.locator('#config-tab-preferences');
    await expect(preferencesTab).toBeVisible();
    await preferencesTab.focus();
    await page.keyboard.press('ArrowRight');
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

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/day.html');
    await expect(page.locator('#gday-quickbar-input')).toBeVisible();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(horizontalOverflow, 'mobile layout should not overflow horizontally').toBe(false);
    expect(uncaught, 'the browser should not emit uncaught JavaScript exceptions').toEqual([]);
});
