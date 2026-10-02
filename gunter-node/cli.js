#!/usr/bin/env node
const { GunterApiClient } = require('./lib/api-client');
const configStore = require('./lib/config-store');
const { GunterNodeRuntime, descriptor } = require('./runtime');
const path = require('path');
const { execFileSync } = require('child_process');

const WINDOWS_TASK_NAME = 'Gunter Node';

async function main(argv = process.argv.slice(2)) {
    const command = argv[0] || 'help';
    const args = parseArgs(argv.slice(1));
    if (command === 'pair') {
        const serverUrl = args.server || 'http://127.0.0.1:3001';
        const pairingToken = args.token;
        if (!pairingToken) throw new Error('Usa --token con el acceso de un solo uso mostrado por Gunter.');
        const claimed = await new GunterApiClient(serverUrl).claim(pairingToken, descriptor(args.name));
        configStore.patch({ serverUrl: new URL(serverUrl).origin, nodeId: claimed.node.nodeId, nodeToken: claimed.nodeToken, deviceName: claimed.node.deviceName, allowedFolders: configStore.load().allowedFolders || [], allowedApps: configStore.load().allowedApps || {}, pairedAt: new Date().toISOString() });
        console.log(`✓ ${claimed.node.deviceName} quedó vinculado a Gunter.`);
        return;
    }
    if (command === 'beeper') {
        if (!args.token) throw new Error('Usa --token con el token local creado en Beeper Desktop.');
        configStore.patch({ beeperToken: args.token });
        console.log('✓ Beeper quedó configurado en este PC. El token no se envió al servidor.');
        return;
    }
    if (command === 'permissions') {
        const files = String(args.files || 'standard').toLowerCase();
        const programs = String(args.programs || 'standard').toLowerCase();
        if (!['standard', 'all'].includes(files) || !['standard', 'all'].includes(programs)) throw new Error('Los permisos válidos son standard o all.');
        if ((files === 'all' || programs === 'all') && args.yes !== true) throw new Error('El acceso general permite leer cualquier ruta autorizada por Windows y abrir cualquier ejecutable. Repite con --yes para confirmarlo.');
        const current = configStore.load();
        configStore.patch({
            fullFilesystemAccess: files === 'all', fullProgramAccess: programs === 'all',
            permissionsUpdatedAt: new Date().toISOString(),
            allowedFolders: files === 'standard' ? (current.allowedFolders || []) : current.allowedFolders || []
        });
        console.log(`✓ Archivos: ${files === 'all' ? 'todo el sistema permitido por Windows' : 'carpetas estándar'}. Programas: ${programs === 'all' ? 'cualquier ejecutable instalado' : 'lista segura'}.`);
        return;
    }
    if (command === 'start') {
        const runtime = new GunterNodeRuntime();
        await runtime.start();
        console.log('● Gunter Node está en línea. Presiona Ctrl+C para detenerlo.');
        const stop = async () => { await runtime.stop(); process.exit(0); };
        process.once('SIGINT', stop); process.once('SIGTERM', stop);
        return;
    }
    if (command === 'install') {
        installResidentTask();
        console.log('✓ Gunter Node se iniciará al abrir sesión en Windows.');
        return;
    }
    if (command === 'uninstall') {
        removeResidentTask();
        console.log('✓ El inicio automático de Gunter Node fue eliminado.');
        return;
    }
    if (command === 'status') { console.log(JSON.stringify(configStore.publicConfig(), null, 2)); return; }
    if (command === 'unpair') { configStore.clear(); console.log('✓ La credencial local fue eliminada. Revoca también el dispositivo desde Gunter si sigue listado.'); return; }
    printHelp();
}

function parseArgs(values) {
    const out = {};
    for (let index = 0; index < values.length; index += 1) {
        const raw = values[index]; if (!raw.startsWith('--')) continue;
        const [key, inline] = raw.slice(2).split('=', 2);
        if (inline !== undefined) out[key] = inline;
        else if (values[index + 1] && !values[index + 1].startsWith('--')) out[key] = values[++index];
        else out[key] = true;
    }
    return out;
}
function printHelp() {
    console.log(`Gunter Node\n\n  pair        --server <url> --token <gp_...> [--name "Mi PC"]\n  permissions --files standard|all --programs standard|all [--yes]\n  beeper      --token <token local de Beeper>\n  start\n  install     instala el inicio automático al abrir sesión en Windows\n  uninstall   elimina el inicio automático de Windows\n  status\n  unpair`);
}

function installResidentTask() {
    if (process.platform !== 'win32') throw new Error('gunter_node_resident_windows_only');
    const config = configStore.load();
    if (!config.nodeId || !config.nodeToken || !config.serverUrl) throw new Error('gunter_node_not_paired');
    runSchtasks(['/Create', '/TN', WINDOWS_TASK_NAME, '/TR', residentCommand(), '/SC', 'ONLOGON', '/F']);
}

function removeResidentTask() {
    if (process.platform !== 'win32') throw new Error('gunter_node_resident_windows_only');
    runSchtasks(['/Delete', '/TN', WINDOWS_TASK_NAME, '/F']);
}

function residentCommand() {
    return `"${process.execPath}" "${path.resolve(__filename)}" start`;
}

function runSchtasks(args) {
    try {
        execFileSync('schtasks.exe', args, { stdio: 'pipe', windowsHide: true });
    } catch (error) {
        const message = String(error.stderr || error.stdout || error.message || 'task_scheduler_failed').trim();
        throw new Error(`gunter_node_task_scheduler_failed: ${message.slice(0, 300)}`);
    }
}

if (require.main === module) main().catch(error => { console.error(`✗ ${error.code || error.message}`); process.exitCode = 1; });
module.exports = { main, parseArgs, residentCommand, WINDOWS_TASK_NAME };
