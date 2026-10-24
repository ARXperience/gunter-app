#!/usr/bin/env node
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { reportApk } = require('./report-android-apk.cjs');

function fixture(t, { variant = 'debug', applicationId, versionName, outputFile = 'app-debug.apk', bytes } = {}) {
    const tempDirectory = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(tempDirectory, 'gunter-apk-report-'));
    // Delete only this exact mkdtemp-owned fixture; never a repository or user path.
    t.after(() => {
        if (path.dirname(root) !== tempDirectory || !path.basename(root).startsWith('gunter-apk-report-') || fs.realpathSync(root) !== root) {
            throw new Error('Refusing cleanup outside the exact owned temporary fixture.');
        }
        fs.rmSync(root, { recursive: true, force: true });
    });
    const directory = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', variant);
    fs.mkdirSync(directory, { recursive: true });
    const apk = bytes || Buffer.alloc(1200);
    if (!bytes) apk.writeUInt32LE(0x04034b50, 0);
    fs.writeFileSync(path.join(directory, 'app-debug.apk'), apk);
    fs.writeFileSync(path.join(directory, 'output-metadata.json'), JSON.stringify({
        applicationId: applicationId || (variant === 'debug' ? 'com.gunter.mobile.preview' : 'com.gunter.mobile'),
        variantName: variant,
        elements: [{ versionCode: 1, versionName: versionName || (variant === 'debug' ? '0.2.0-preview' : '0.2.0'), outputFile }],
    }));
    return { root, apk };
}

test('preview report identifies the exact artifact without claiming acceptance', t => {
    const { root, apk } = fixture(t);
    const report = reportApk('debug', root);
    assert.equal(report.applicationId, 'com.gunter.mobile.preview');
    assert.equal(report.status, 'PREVIEW_NOT_FOR_CLIENT_DISTRIBUTION');
    assert.equal(report.sha256, crypto.createHash('sha256').update(apk).digest('hex'));
    assert.equal(report.signatureVerified, false);
    assert.equal(report.physicalDeviceQa, 'NOT_EXECUTED_BY_THIS_REPORT');
});
test('release metadata alone never claims a ready client release', t => {
    const { root } = fixture(t, { variant: 'release' });
    assert.equal(reportApk('release', root).status, 'UNVERIFIED_RELEASE_ARTIFACT');
});
test('preview cannot masquerade as the existing companion package', t => {
    const { root } = fixture(t, { applicationId: 'com.gunter.mobile' });
    assert.throws(() => reportApk('debug', root), /metadata/);
});
test('preview version must visibly distinguish the candidate', t => {
    const { root } = fixture(t, { versionName: '1.0.0' });
    assert.throws(() => reportApk('debug', root), /labelled/);
});
for (const outputFile of ['../secret.apk', '..\\secret.apk', '/secret.apk']) {
    test(`metadata cannot redirect the report to ${JSON.stringify(outputFile)}`, t => {
        const { root } = fixture(t, { outputFile });
        assert.throws(() => reportApk('debug', root), /filename/);
    });
}
test('non-APK bytes and unknown variants are rejected', t => {
    const { root } = fixture(t, { bytes: Buffer.alloc(1200) });
    assert.throws(() => reportApk('debug', root), /ZIP/);
    assert.throws(() => reportApk('production', root), /Variant/);
});
