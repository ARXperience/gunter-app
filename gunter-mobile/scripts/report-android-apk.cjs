#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// This report identifies the exact artifact. It deliberately does not claim a
// successful install, verified signature, working backend or physical-device QA.
function reportApk(variant = 'debug', mobileRoot = path.resolve(__dirname, '..')) {
    if (!['debug', 'release'].includes(variant)) throw new Error('Variant must be debug or release.');
    const apkDirectory = path.join(mobileRoot, 'android', 'app', 'build', 'outputs', 'apk', variant);
    const metadata = JSON.parse(fs.readFileSync(path.join(apkDirectory, 'output-metadata.json'), 'utf8'));
    const expectedId = variant === 'debug' ? 'com.gunter.mobile.preview' : 'com.gunter.mobile';
    if (metadata.applicationId !== expectedId || metadata.variantName !== variant || metadata.elements?.length !== 1) {
        throw new Error('APK metadata does not match the selected isolated preview/distribution variant.');
    }
    const element = metadata.elements[0];
    const filename = element.outputFile;
    if (typeof filename !== 'string' || /[\\/]/.test(filename) || path.basename(filename) !== filename || !filename.endsWith('.apk')) {
        throw new Error('Unexpected APK output filename.');
    }
    if (variant === 'debug' && !String(element.versionName).endsWith('-preview')) {
        throw new Error('Preview APK must be labelled -preview.');
    }
    const apkPath = path.join(apkDirectory, filename);
    const stat = fs.lstatSync(apkPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1000 || stat.size > 512 * 1024 * 1024) {
        throw new Error('Expected a regular APK file between 1 KB and 512 MB.');
    }
    const bytes = fs.readFileSync(apkPath);
    if (bytes.readUInt32LE(0) !== 0x04034b50) throw new Error('APK is not a ZIP archive.');
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        status: variant === 'debug' ? 'PREVIEW_NOT_FOR_CLIENT_DISTRIBUTION' : 'UNVERIFIED_RELEASE_ARTIFACT',
        variant,
        applicationId: metadata.applicationId,
        versionCode: element.versionCode,
        versionName: element.versionName,
        apk: path.relative(mobileRoot, apkPath).split(path.sep).join('/'),
        bytes: stat.size,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        signatureVerified: false,
        physicalDeviceQa: 'NOT_EXECUTED_BY_THIS_REPORT',
        pushDelivery: 'NOT_VERIFIED_BY_THIS_REPORT',
        backendAvailability: 'NOT_VERIFIED_BY_THIS_REPORT',
        acceptanceRequired: [
            'Verify the APK with the official Android apksigner tool and the expected signing identity.',
            'Install and exercise all supported workflows on physical Android devices.',
            'Verify HTTPS deployment, account isolation, permissions and optional push end to end.',
        ],
    };
}

if (require.main === module) {
    try {
        if (process.argv.length > 3) throw new Error('Usage: node report-android-apk.cjs [debug|release]');
        const variant = process.argv[2] || 'debug';
        const report = reportApk(variant);
        const reportDirectory = path.resolve(__dirname, '..', 'reports');
        fs.mkdirSync(reportDirectory, { recursive: true });
        const destination = path.join(reportDirectory, `android-${variant}-apk.json`);
        fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { flag: 'w' });
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
        process.stderr.write(`Android APK report failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = { reportApk };
