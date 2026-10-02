const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-node-test-'));
process.env.GUNTER_NODE_HOME = path.join(testDir, 'config');

const configStore = require('../gunter-node/lib/config-store');
const { validateServerUrl } = require('../gunter-node/lib/api-client');
const { execute, latestDownload, allowedPath, listPath, searchFiles } = require('../gunter-node/lib/executors');
const { GunterNodeRuntime } = require('../gunter-node/runtime');
const { parseArgs, residentCommand, WINDOWS_TASK_NAME } = require('../gunter-node/cli');
const { mimeFor, attachmentPayload } = require('../gunter-node/lib/beeper-bridge');

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log(`  ✓ ${name}`); }

(async () => {
    console.log('GUNTER NODE CORE');

    await test('cifra credenciales locales y solo expone estado público', () => {
        const saved = configStore.save({ serverUrl: 'http://127.0.0.1:3001', nodeId: 'node_1', nodeToken: 'gn_super_secret', beeperToken: 'beeper_super_secret', deviceName: 'PC QA' });
        assert.equal(saved.nodeId, 'node_1');
        assert.equal(configStore.load().nodeToken, 'gn_super_secret');
        const encrypted = fs.readFileSync(path.join(process.env.GUNTER_NODE_HOME, 'config.enc'), 'utf8');
        assert.equal(encrypted.includes('gn_super_secret'), false);
        assert.equal(encrypted.includes('beeper_super_secret'), false);
        assert.deepEqual(configStore.publicConfig().beeperConfigured, true);
    });

    await test('exige HTTPS remoto pero permite desarrollo local', () => {
        assert.equal(validateServerUrl('http://127.0.0.1:3001'), 'http://127.0.0.1:3001');
        assert.equal(validateServerUrl('https://gunter.example.com/path'), 'https://gunter.example.com');
        assert.throws(() => validateServerUrl('http://gunter.example.com'), /gunter_node_https_required/);
    });

    await test('encuentra el archivo más reciente solo dentro de rutas permitidas', () => {
        const downloads = path.join(testDir, 'Downloads'); fs.mkdirSync(downloads);
        const oldFile = path.join(downloads, 'anterior.txt'), newFile = path.join(downloads, 'ultimo.txt');
        fs.writeFileSync(oldFile, 'old'); fs.writeFileSync(newFile, 'new');
        fs.utimesSync(oldFile, new Date(1000), new Date(1000));
        const result = latestDownload({}, { allowedFolders: [downloads] });
        assert.equal(result.result.file.name, 'ultimo.txt');
        assert.equal(result.evidence.fileFound, true);
        assert.ok(result.evidence.pathHash);
    });

    await test('el permiso general habilita cualquier ruta absoluta autorizada por el sistema', () => {
        const outside = path.join(testDir, 'OtroDisco'); fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, 'informe-final.pdf'), 'pdf');
        assert.throws(() => allowedPath(outside, [path.join(testDir, 'Downloads')], false), /desktop_path_not_allowed/);
        assert.equal(allowedPath(outside, [], true), path.resolve(outside));
        const listed = listPath({ path: outside }, { fullFilesystemAccess: true });
        assert.equal(listed.result.items[0].name, 'informe-final.pdf');
        const found = searchFiles({ root: testDir, query: 'informe', maxDepth: 3 }, { fullFilesystemAccess: true });
        assert.equal(found.result.items.some(item => item.name === 'informe-final.pdf'), true);
    });

    await test('multimedia usa únicamente acciones fijas y verifica el evento del sistema', async () => {
        const requests = [];
        const result = await execute({ skill: 'desktop.media.play_pause', payload: {} }, {
            windowsAutomation: async request => {
                requests.push(request);
                return { result: { action: request.mediaAction }, evidence: { mediaCommandSent: true, action: request.mediaAction } };
            }
        });
        assert.equal(requests[0].action, 'media');
        assert.equal(requests[0].mediaAction, 'play_pause');
        assert.equal(result.evidence.mediaCommandSent, true);
        await assert.rejects(() => execute({ skill: 'desktop.media.run_script', payload: {} }, {}), /desktop_media_action_not_allowed/);
    });

    await test('la interacción accesible limita y valida ventana, control y texto', async () => {
        const requests = [];
        const result = await execute({
            skill: 'desktop.ui.type',
            payload: { app: 'notepad', target: { name: 'Contenido' }, text: 'Hola desde Gunter' }
        }, {
            windowsAutomation: async request => {
                requests.push(request);
                return { result: { window: 'Bloc de notas', target: 'Contenido', characters: request.text.length }, evidence: { valueSet: true } };
            }
        });
        assert.equal(requests[0].action, 'type');
        assert.equal(requests[0].target.name, 'Contenido');
        assert.equal(result.evidence.valueSet, true);
        assert.ok(result.evidence.targetHash);
        await assert.rejects(() => execute({ skill: 'desktop.ui.type', payload: { app: 'notepad', text: 'sin campo' } }, { windowsAutomation: async () => ({}) }), /desktop_ui_target_required/);
        await assert.rejects(() => execute({ skill: 'desktop.ui.type', payload: { app: 'notepad', target: { name: 'Contraseña' }, text: 'secreto' } }, { windowsAutomation: async () => ({}) }), /desktop_ui_sensitive_field_not_allowed/);
    });

    await test('captura un objetivo bajo el cursor sin almacenar coordenadas', async () => {
        const requests = [];
        const result = await execute({ skill: 'desktop.ui.capture_target', payload: { delayMs: 2500 } }, {
            windowsAutomation: async request => {
                requests.push(request);
                return { result: { app: 'notepad', window: 'Bloc de notas', target: { name: 'Contenido', automationId: '15', controlType: 'Edit', supportedActions: ['type'] } }, evidence: { targetCaptured: true } };
            }
        });
        assert.equal(requests[0].action, 'capture_target');
        assert.equal(requests[0].delayMs, 2500);
        assert.equal(result.result.target.name, 'Contenido');
        assert.equal(result.result.x, undefined);
        assert.equal(result.evidence.targetCaptured, true);
        assert.ok(result.evidence.targetHash);
        await assert.rejects(() => execute({ skill: 'desktop.ui.capture_target', payload: {} }, {
            windowsAutomation: async () => ({ result: { app: 'explorer', target: { name: '', automationId: '' } }, evidence: { targetCaptured: true } })
        }), /desktop_ui_control_not_identifiable/);
    });

    await test('espera, desplaza, usa atajos seguros y selecciona archivos permitidos', async () => {
        const target = { app: 'notepad', target: { name: 'Contenido' } };
        const wait = await execute({ skill: 'desktop.ui.wait', payload: { ...target, timeoutMs: 2500 } }, {
            windowsAutomation: async request => ({ result: { window: request.app, target: request.target.name }, evidence: { targetObserved: true } })
        });
        assert.equal(wait.evidence.targetObserved, true);
        const scroll = await execute({ skill: 'desktop.ui.scroll', payload: { ...target, direction: 'down', amount: 4 } }, {
            windowsAutomation: async request => ({ result: { direction: request.direction, amount: request.amount }, evidence: { scrollChanged: true } })
        });
        assert.equal(scroll.result.amount, 4);
        const hotkey = await execute({ skill: 'desktop.ui.hotkey', payload: { app: 'notepad', shortcut: 'ctrl+s' } }, {
            windowsAutomation: async request => ({ result: { shortcut: request.shortcut }, evidence: { shortcutSent: true } })
        });
        assert.equal(hotkey.result.shortcut, 'ctrl+s');
        await assert.rejects(() => execute({ skill: 'desktop.ui.hotkey', payload: { app: 'notepad', shortcut: 'win+r' } }, {
            windowsAutomation: async () => ({})
        }), /desktop_ui_shortcut_not_allowed/);

        const allowedFolder = path.join(testDir, 'AllowedFiles'); fs.mkdirSync(allowedFolder, { recursive: true });
        const selectedPath = path.join(allowedFolder, 'informe.pdf'); fs.writeFileSync(selectedPath, 'pdf');
        const selected = await execute({ skill: 'desktop.ui.select_file', payload: { app: 'notepad', filePath: selectedPath } }, {
            allowedFolders: [allowedFolder],
            windowsAutomation: async request => ({ result: { fileName: path.basename(request.filePath) }, evidence: { fileSelected: true } })
        });
        assert.equal(selected.result.fileName, 'informe.pdf');
        assert.ok(selected.evidence.pathHash);
        await assert.rejects(() => execute({ skill: 'desktop.ui.select_file', payload: { app: 'notepad', filePath: path.join(testDir, 'outside.pdf') } }, {
            allowedFolders: [allowedFolder], windowsAutomation: async () => ({})
        }), /desktop_path_not_allowed/);
    });

    await test('runtime hace heartbeat, ejecuta y reporta evidencia', async () => {
        const calls = { heartbeat: 0, result: [], event: [] };
        let pulled = false;
        const api = {
            heartbeat: async () => { calls.heartbeat += 1; return { ok: true }; },
            pull: async () => ({ items: pulled ? [] : (pulled = true, [{ id: 'cmd_1', skill: 'desktop.apps.open', payload: { app: 'notepad' } }]) }),
            result: async value => { calls.result.push(value); return { ok: true }; },
            event: async value => { calls.event.push(value); return { ok: true }; }
        };
        const beeper = { snapshot: { reachable: false }, start: async () => {}, stop: () => {}, syncRecent: async () => [], send: async () => ({}) };
        const runtime = new GunterNodeRuntime({ serverUrl: 'http://127.0.0.1:3001', nodeId: 'node_1', nodeToken: 'gn_token' }, {
            api, beeper, execute: async () => ({ result: { launched: true }, evidence: { processStarted: true, executableAllowed: true, executableHash: 'abc' } })
        });
        await runtime.start(); await runtime.stop();
        assert.ok(calls.heartbeat >= 2);
        assert.equal(calls.result[0].commandId, 'cmd_1');
        assert.equal(calls.result[0].evidence.executableAllowed, true);
    });

    await test('adjuntos Beeper conservan metadatos mínimos y tipo seguro', () => {
        assert.equal(mimeFor('foto.PNG'), 'image/png');
        assert.equal(mimeFor('sin-extension.bin'), 'application/octet-stream');
        assert.deepEqual(attachmentPayload({ uploadID: 'up_1', fileName: 'foto.png', mimeType: 'image/png', width: 640, height: 480 }), {
            uploadID: 'up_1', fileName: 'foto.png', mimeType: 'image/png', type: 'image', size: { width: 640, height: 480 }
        });
    });

    await test('CLI interpreta argumentos de emparejamiento', () => {
        assert.deepEqual(parseArgs(['--server', 'https://gunter.test', '--token=gp_123', '--name', 'Mi PC']), { server: 'https://gunter.test', token: 'gp_123', name: 'Mi PC' });
        assert.deepEqual(parseArgs(['--files', 'all', '--programs=all', '--yes']), { files: 'all', programs: 'all', yes: true });
    });

    await test('tarea residente usa el ejecutable y script actuales', () => {
        assert.equal(WINDOWS_TASK_NAME, 'Gunter Node');
        assert.ok(residentCommand().includes('cli.js'));
        assert.ok(residentCommand().endsWith(' start'));
    });

    fs.rmSync(testDir, { recursive: true, force: true });
    console.log(`\n${passed} pruebas de Gunter Node pasaron.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
