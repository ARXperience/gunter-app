const path = require('node:path');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: __dirname,
    testMatch: '**/*.spec.cjs',
    timeout: 90_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
    outputDir: process.env.GUNTER_E2E_OUTPUT_DIR || path.join(__dirname, '..', '..', 'output', 'playwright'),
    use: {
        baseURL: process.env.GUNTER_BASE_URL || 'http://127.0.0.1:3001',
        browserName: 'chromium',
        headless: true,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        actionTimeout: 12_000,
        navigationTimeout: 20_000
    }
});
