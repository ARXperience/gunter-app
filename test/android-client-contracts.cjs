/* Source contracts + real pure server verification. Not an Android device test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const native = name => read(`gunter-mobile/android/app/src/main/java/com/gunter/mobile/${name}.kt`);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };
test('launcher cliente y permisos mínimos explícitos', () => {
    const manifest = read('gunter-mobile/android/app/src/main/AndroidManifest.xml');
    assert.match(manifest, /GunterWebActivity[\s\S]*?android.intent.category.LAUNCHER/);
    assert.match(manifest, /MainActivity" android:exported="false"/);
    assert.match(manifest, /usesCleartextTraffic="false"/);
    assert.match(manifest, /android.permission.RECORD_AUDIO/);
    assert.match(manifest, /android.intent.action.BOOT_COMPLETED/);
    assert.doesNotMatch(manifest, /SEND_SMS|MANAGE_EXTERNAL_STORAGE|QUERY_ALL_PACKAGES|CAMERA|BIND_ACCESSIBILITY_SERVICE/);
});
test('vista web sin puente privilegiado ni evasión SSL', () => {
    const shell = native('GunterWebActivity');
    assert.doesNotMatch(shell, /addJavascriptInterface|handler\.proceed\(|MIXED_CONTENT_ALWAYS_ALLOW/);
    for (const guard of ['allowFileAccess = false', 'allowContentAccess = false', 'MIXED_CONTENT_NEVER_ALLOW', 'setAcceptThirdPartyCookies(view, false)', 'handler.cancel()', 'PermissionRequest.RESOURCE_AUDIO_CAPTURE', 'request.origin', 'GunterAndroid/0.2']) assert.ok(shell.includes(guard), guard);
});
test('descargas a selector autorizado, acotadas y sin redirect externo', () => {
    const download = native('WebDownloadController');
    for (const guard of ['ACTION_CREATE_DOCUMENT', 'instanceFollowRedirects = false', 'download.policy.isInternal(address)', 'destination?.scheme != "content"', 'total <= MAX_BYTES', 'worker.shutdownNow()', 'getCookie(download.address)']) assert.ok(download.includes(guard), guard);
    assert.doesNotMatch(download, /setAcceptAll|addJavascriptInterface|Environment\.getExternalStorageDirectory/);
});
test('credencial del nodo no sigue redirects ni se expone al motor web', () => {
    const api = native('NodeApi');
    assert.match(api, /WebOriginPolicy.fromConfiguredOrigin\(base, allowLoopbackHttp = BuildConfig.DEBUG && BuildConfig.GUNTER_WEB_ORIGIN.isBlank\(\)\)/);
    assert.match(api, /instanceFollowRedirects = false/);
    assert.match(api, /gunter_mobile_redirect_blocked/);
    assert.match(api, /if \(!BuildConfig.DEBUG\) require\(origin == WebOriginPolicy.fromConfiguredOrigin\(BuildConfig.GUNTER_WEB_ORIGIN\)\?\.origin\)/);
    assert.match(native('MainActivity'), /runCatching \{ NodeApi\(config.serverUrl\) \}\.isFailure/);
    assert.match(api, /finally \{ connection.disconnect\(\) \}/);
    assert.doesNotMatch(native('GunterWebActivity'), /nodeToken|loadUrl\([^\n]*Authorization/);
});
test('build debug aislado y release con origen/firma externos', () => {
    const build = read('gunter-mobile/android/app/build.gradle.kts');
    assert.match(build, /applicationIdSuffix = "\.preview"/);
    assert.match(build, /dependsOn\(validateGunterRelease\)/);
    assert.match(build, /require\(hasReleaseSigning\)/);
    assert.match(build, /require\(gunterWebOrigin.isNotEmpty\(\)\)/);
    assert.match(native('MainActivity'), /server.isEnabled = BuildConfig.DEBUG/);
});
test('HTTP local sólo preview opt-in con host literal y release cerrado', () => {
    const debugManifest = read('gunter-mobile/android/app/src/debug/AndroidManifest.xml');
    const network = read('gunter-mobile/android/app/src/debug/res/xml/gunter_debug_network_security.xml').replace(/<!--[\s\S]*?-->/g, '');
    const mainManifest = read('gunter-mobile/android/app/src/main/AndroidManifest.xml');
    const policy = native('WebOriginPolicy');
    const shell = native('GunterWebActivity');
    assert.match(debugManifest, /networkSecurityConfig="@xml\/gunter_debug_network_security"/);
    assert.match(network, /<base-config cleartextTrafficPermitted="false"\s*\/>/);
    assert.match(network, /<domain-config cleartextTrafficPermitted="true">[\s\S]*?<domain includeSubdomains="false">127\.0\.0\.1<\/domain>/);
    assert.equal((network.match(/<domain\s/g) || []).length, 1);
    assert.doesNotMatch(network, /trust-anchors|certificates|localhost|includeSubdomains="true"/);
    assert.match(mainManifest, /usesCleartextTraffic="false"/);
    assert.doesNotMatch(mainManifest, /networkSecurityConfig/);
    assert.match(policy, /allowLoopbackHttp: Boolean = false/);
    assert.match(policy, /uri\.host == "127\.0\.0\.1"/);
    assert.match(policy, /uri\.port in 1024\.\.65535 && uri\.port != 3013/);
    assert.match(shell, /allowLoopbackHttp = BuildConfig.DEBUG && fixed.isBlank\(\)/);
    assert.match(shell, /policy\?\.isAllowedResource\(request\.url\.toString\(\)\)/);
    assert.match(native('WebBlobExportController'), /!policy\.isInternal\(sourceOrigin\.toString\(\)\)/);
});
test('sesiones, datos y vinculación quedan excluidos de backup y transferencia Android', () => {
    const manifest = read('gunter-mobile/android/app/src/main/AndroidManifest.xml');
    assert.match(manifest, /allowBackup="false"/);
    assert.match(manifest, /fullBackupContent="@xml\/gunter_backup_rules"/);
    assert.match(manifest, /dataExtractionRules="@xml\/gunter_data_extraction_rules"/);
    const legacy = read('gunter-mobile/android/app/src/main/res/xml/gunter_backup_rules.xml');
    const modern = read('gunter-mobile/android/app/src/main/res/xml/gunter_data_extraction_rules.xml');
    const domains = ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref'];
    for (const rules of [legacy, modern.match(/<cloud-backup>([\s\S]*?)<\/cloud-backup>/)?.[1], modern.match(/<device-transfer>([\s\S]*?)<\/device-transfer>/)?.[1]]) {
        assert.ok(rules);
        assert.doesNotMatch(rules, /<include\s/);
        for (const domain of domains) assert.ok(rules.includes(`<exclude domain="${domain}" path="." />`), domain);
    }
});
test('recordatorios durables y no anuncio de hora exacta', () => {
    assert.match(native('ReminderStore'), /\.commit\(\)/);
    assert.match(native('ReminderStore'), /storage.get\(id\) != record/);
    assert.match(native('ReminderReceiver'), /setAndAllowWhileIdle/);
    assert.match(native('ReminderReceiver'), /NotificationCompat.VISIBILITY_PRIVATE/);
    assert.match(native('MobileExecutors'), /put\("deliveryGuaranteed", false\)/);
});
test('push manejado nativamente exige configuración, opt-in y vínculo válido', () => {
    const push = native('GunterMessagingService');
    assert.match(push, /!BuildConfig.GUNTER_FCM_CONFIGURED/);
    assert.match(push, /getBoolean\("push_enabled", false\)/);
    assert.match(push, /message.data\["kind"\] != "GUNTER_COMMAND_READY"/);
    assert.match(push, /runCatching \{ NodeApi\(config.serverUrl\) \}\.isFailure/);
    const manifest = read('gunter-mobile/android/app/src/main/AndroidManifest.xml');
    assert.match(manifest, /firebase_messaging_auto_init_enabled" android:value="false"/);
    assert.match(manifest, /firebase_analytics_collection_enabled" android:value="false"/);
    const activity = native('MainActivity');
    assert.match(activity, /isAutoInitEnabled = true/);
    assert.match(activity, /isAutoInitEnabled = false/);
    assert.match(activity, /if \(!pushStillAllowed\(config\)\) return@addOnCompleteListener/);
});
const context = { module: { exports: {} }, require: () => ({}), Buffer };
vm.runInNewContext(read('server/control-plane/skills.js'), context, { filename: 'skills.js' });
const verify = context.module.exports.verify;
test('despachar intent no se presenta como efecto verificado', () => {
    for (const skill of ['mobile.open_app', 'mobile.files.open', 'mobile.message.prepare']) {
        const result = verify(skill, { evidence: { intentDispatched: true, effectVerified: false } });
        assert.equal(result.verified, false);
        assert.equal(result.limitation, 'intent_dispatched_effect_not_observed');
    }
});
test('alarma local nueva exige persistencia reconsultada y programación', () => {
    const evidence = { persistedId: 'fixture', persisted: true, reconsulted: true, alarmScheduled: true, exact: false, deliveryGuaranteed: false };
    assert.equal(verify('mobile.reminder', { evidence }).verified, true);
    assert.equal(verify('mobile.reminder', { evidence }).limitation, 'scheduled_locally_not_delivery_confirmed');
    for (const key of ['persisted', 'reconsulted', 'alarmScheduled']) assert.equal(verify('mobile.reminder', { evidence: { ...evidence, [key]: false } }).verified, false);
    // Preserve the existing iOS v1 contract, but never claim delivery.
    assert.equal(verify('mobile.reminder', { evidence: { persistedId: 'legacy-fixture' } }).limitation, 'scheduled_locally_not_delivery_confirmed');
});
test('fallo de reporte no repite el efecto ni manda resultado ficticio', () => {
    const service = native('GunterNodeService');
    assert.equal((service.match(/api\.result\(/g) || []).length, 1);
    assert.match(service, /podría haberse ejecutado/);
    assert.match(service, /for \(index in 0 until items.length\(\)\) \{\s*if \(!running.get\(\) \|\| Thread.currentThread\(\).isInterrupted\) break/);
});
console.log(`ANDROID CLIENT CONTRACTS: ${passed} passed; source contracts are not device acceptance.`);
