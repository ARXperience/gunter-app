const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const WINDOWS_APPS = Object.freeze({
    notepad: 'notepad.exe', bloc_de_notas: 'notepad.exe', calculator: 'calc.exe', calculadora: 'calc.exe',
    explorer: 'explorer.exe', explorador: 'explorer.exe', paint: 'mspaint.exe'
});

const MEDIA_ACTIONS = Object.freeze(new Set([
    'play_pause', 'next', 'previous', 'stop', 'volume_up', 'volume_down', 'mute'
]));

const UI_ACTIONS = Object.freeze(new Set(['inspect', 'capture_target', 'focus', 'click', 'type', 'wait', 'scroll', 'hotkey', 'select_file']));
const UI_SHORTCUTS = Object.freeze(new Set([
    'ctrl+s', 'ctrl+c', 'ctrl+v', 'ctrl+a', 'ctrl+f', 'alt+f4',
    'enter', 'escape', 'tab', 'shift+tab', 'delete', 'backspace',
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright'
]));

async function execute(command, context = {}) {
    if (command.skill === 'desktop.apps.open') return openApp(command.payload || {}, context);
    if (command.skill === 'desktop.apps.discover') return discoverPrograms(command.payload || {}, context);
    if (command.skill === 'desktop.permissions.update') return context.updatePermissions ? context.updatePermissions(command.payload || {}) : unavailable('permission_runtime_unavailable');
    if (command.skill === 'desktop.files.open') return openPath(command.payload || {}, context);
    if (command.skill === 'desktop.files.latest') return latestDownload(command.payload || {}, context);
    if (command.skill === 'desktop.files.list') return listPath(command.payload || {}, context);
    if (command.skill === 'desktop.files.search') return searchFiles(command.payload || {}, context);
    if (command.skill.startsWith('desktop.media.')) return mediaControl(command.skill.slice('desktop.media.'.length), context);
    if (command.skill.startsWith('desktop.ui.')) return uiControl(command.skill.slice('desktop.ui.'.length), command.payload || {}, context);
    if (command.skill === 'social.beeper.sync') return context.beeperSync ? context.beeperSync(command.payload || {}) : unavailable('beeper_not_configured');
    if (command.skill === 'social.beeper.send') return context.beeperSend ? context.beeperSend(command.payload || {}) : unavailable('beeper_not_configured');
    throw coded('skill_not_supported_by_runtime');
}

async function mediaControl(action, context = {}) {
    if (!MEDIA_ACTIONS.has(action)) throw coded('desktop_media_action_not_allowed');
    const runner = context.windowsAutomation || runWindowsAutomation;
    const output = await runner({ action: 'media', mediaAction: action });
    if (!output?.evidence?.mediaCommandSent) throw coded('desktop_media_not_verified');
    return output;
}

async function uiControl(action, payload, context = {}) {
    if (!UI_ACTIONS.has(action)) throw coded('desktop_ui_action_not_allowed');
    const securedPayload = { ...payload };
    if (action === 'select_file') {
        const selected = allowedPath(payload.filePath || payload.path, context.allowedFolders, context.fullFilesystemAccess);
        if (!fs.existsSync(selected) || !fs.statSync(selected).isFile()) throw coded('desktop_file_not_found');
        securedPayload.filePath = selected;
    }
    const request = sanitizeUiRequest(action, securedPayload);
    const runner = context.windowsAutomation || runWindowsAutomation;
    const output = await runner(request);
    const expectedEvidence = {
        inspect: 'controlsInspected', capture_target: 'targetCaptured', focus: 'windowFocused',
        click: 'controlInvoked', type: 'valueSet', wait: 'targetObserved', scroll: 'scrollChanged',
        hotkey: 'shortcutSent', select_file: 'fileSelected'
    }[action];
    if (output?.evidence?.[expectedEvidence] !== true) throw coded('desktop_ui_not_verified');
    if (action === 'capture_target' && ((!output.result?.app && !output.result?.window) || (!output.result?.target?.name && !output.result?.target?.automationId))) {
        throw coded('desktop_ui_control_not_identifiable');
    }
    const evidenceTarget = action === 'capture_target'
        ? { app: output.result?.app, window: output.result?.window, target: output.result?.target }
        : { window: request.window, app: request.app, target: request.target, shortcut: request.shortcut, direction: request.direction };
    const extraEvidence = action === 'select_file' ? { pathHash: hash(request.filePath) } : {};
    return {
        result: output.result || {},
        evidence: { ...(output.evidence || {}), ...extraEvidence, targetHash: hash(JSON.stringify(evidenceTarget)) }
    };
}

function sanitizeUiRequest(action, payload = {}) {
    const clean = value => String(value || '').trim().slice(0, 300);
    const target = payload.target && typeof payload.target === 'object' ? {
        name: clean(payload.target.name), automationId: clean(payload.target.automationId), controlType: clean(payload.target.controlType)
    } : { name: clean(payload.target) };
    const request = {
        action, app: clean(payload.app), window: clean(payload.window || payload.windowTitle), target,
        text: action === 'type' ? String(payload.text || '').slice(0, 12000) : '', limit: Math.max(1, Math.min(Number(payload.limit) || 120, 250)),
        delayMs: action === 'capture_target' ? Math.max(1000, Math.min(Number(payload.delayMs) || 5000, 10000)) : 0,
        timeoutMs: action === 'wait' ? Math.max(1000, Math.min(Number(payload.timeoutMs) || 10000, 30000)) : 0,
        direction: action === 'scroll' ? clean(payload.direction).toLowerCase() || 'down' : '',
        amount: action === 'scroll' ? Math.max(1, Math.min(Number(payload.amount) || 3, 10)) : 0,
        shortcut: action === 'hotkey' ? clean(payload.shortcut).toLowerCase().replace(/\s+/g, '') : '',
        filePath: action === 'select_file' ? String(payload.filePath || '').slice(0, 4096) : ''
    };
    if (!['capture_target', 'hotkey', 'select_file'].includes(action) && !request.app && !request.window) throw coded('desktop_ui_window_required');
    if (['click', 'type'].includes(action) && !target.name && !target.automationId) throw coded('desktop_ui_target_required');
    if (action === 'wait' && !target.name && !target.automationId) throw coded('desktop_ui_target_required');
    if (action === 'type' && !request.text) throw coded('desktop_ui_text_required');
    if (action === 'type' && /password|passcode|contrase(?:n|ñ)a|clave|token|secret|otp|pin/i.test(`${target.name} ${target.automationId}`)) {
        throw coded('desktop_ui_sensitive_field_not_allowed');
    }
    if (action === 'scroll' && !['up', 'down', 'left', 'right'].includes(request.direction)) throw coded('desktop_ui_scroll_direction_not_allowed');
    if (action === 'hotkey' && !UI_SHORTCUTS.has(request.shortcut)) throw coded('desktop_ui_shortcut_not_allowed');
    if (action === 'select_file' && !request.filePath) throw coded('desktop_file_path_required');
    return request;
}

function runWindowsAutomation(request) {
    if (process.platform !== 'win32') return Promise.reject(coded('desktop_platform_not_supported'));
    const script = path.join(__dirname, '..', 'windows', 'ui-automation.ps1');
    if (!fs.existsSync(script)) return Promise.reject(coded('desktop_ui_runtime_missing'));
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
            windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
        });
        let stdout = '', stderr = '', settled = false;
        const finish = (error, value) => {
            if (settled) return; settled = true; clearTimeout(timer);
            if (error) reject(error); else resolve(value);
        };
        child.stdout.on('data', chunk => { if (stdout.length < 1024 * 1024) stdout += chunk.toString('utf8'); });
        child.stderr.on('data', chunk => { if (stderr.length < 16384) stderr += chunk.toString('utf8'); });
        child.on('error', error => finish(Object.assign(error, { code: error.code || 'desktop_ui_runtime_failed' })));
        child.on('close', code => {
            let parsed = null;
            try { parsed = JSON.parse(stdout.trim()); } catch { /* handled below */ }
            if (code !== 0 || !parsed?.ok) return finish(coded(parsed?.error || (stderr.trim() ? 'desktop_ui_runtime_failed' : 'desktop_ui_invalid_response')));
            finish(null, { result: parsed.result || {}, evidence: parsed.evidence || {} });
        });
        const runtimeTimeout = request.action === 'wait' ? request.timeoutMs + 5000 : 15000;
        const timer = setTimeout(() => { child.kill(); finish(coded('desktop_ui_timeout')); }, runtimeTimeout);
        child.stdin.end(JSON.stringify(request), 'utf8');
    });
}

function openApp(payload, context = {}) {
    if (process.platform !== 'win32') throw coded('desktop_platform_not_supported');
    const name = normalizeName(payload.app);
    const configured = { ...WINDOWS_APPS, ...(context.allowedApps || {}) }[name];
    const requestedPath = payload.programPath || payload.path || (/^[a-zA-Z]:[\\/]/.test(String(payload.app || '')) ? payload.app : null);
    let executable = configured;
    if (requestedPath) {
        if (context.fullProgramAccess !== true) throw coded('desktop_program_full_access_required');
        executable = path.resolve(String(requestedPath));
        if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) throw coded('desktop_program_not_found');
        if (!['.exe', '.com', '.lnk'].includes(path.extname(executable).toLowerCase())) throw coded('desktop_program_type_not_allowed');
    }
    if (!executable && context.fullProgramAccess === true && payload.app) {
        const candidates = discoverPrograms({ query: String(payload.app) }, context).result.items;
        const exact = candidates.filter(item => normalizeName(item.name) === name);
        if (exact.length === 1) executable = exact[0].path;
        else if (exact.length > 1 || candidates.length > 1) throw coded('desktop_app_ambiguous');
        else if (candidates.length === 1) executable = candidates[0].path;
    }
    if (!executable) throw coded('desktop_app_not_allowed');
    const isShortcut = path.extname(executable).toLowerCase() === '.lnk';
    const child = isShortcut
        ? spawn('explorer.exe', [executable], { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return {
        result: { launched: true, app: name || path.basename(executable) },
        evidence: { processStarted: Boolean(child.pid), processId: child.pid || null, executableAllowed: true, executableHash: hash(executable) }
    };
}

function openPath(payload, context = {}) {
    if (process.platform !== 'win32') throw coded('desktop_platform_not_supported');
    const target = allowedPath(payload.path, context.allowedFolders, context.fullFilesystemAccess);
    if (!fs.existsSync(target)) throw coded('desktop_path_not_found');
    const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { result: { opened: true, name: path.basename(target), kind: fs.statSync(target).isDirectory() ? 'folder' : 'file' }, evidence: { pathOpened: Boolean(child.pid), pathHash: hash(target) } };
}

function latestDownload(payload, context = {}) {
    const roots = normalizedRoots(context.allowedFolders);
    const downloads = roots.find(root => path.basename(root).toLowerCase() === 'downloads') || path.join(os.homedir(), 'Downloads');
    const root = allowedPath(downloads, roots, context.fullFilesystemAccess);
    if (!fs.existsSync(root)) throw coded('downloads_folder_not_found');
    const requestedType = String(payload.type || '').toLowerCase();
    const rows = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
        const fullPath = path.join(root, entry.name); const stat = fs.statSync(fullPath);
        return { fullPath, name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString(), mtime: stat.mtimeMs };
    }).filter(item => !requestedType || path.extname(item.name).slice(1).toLowerCase() === requestedType).sort((a, b) => b.mtime - a.mtime);
    if (!rows.length) throw coded('download_not_found');
    const file = rows[0];
    return { result: { file: { path: file.fullPath, name: file.name, size: file.size, modifiedAt: file.modifiedAt } }, evidence: { fileFound: true, pathHash: hash(file.fullPath) } };
}

function listPath(payload, context = {}) {
    const target = allowedPath(payload.path, context.allowedFolders, context.fullFilesystemAccess);
    if (!fs.existsSync(target)) throw coded('desktop_path_not_found');
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) return { result: { path: target, items: [fileInfo(target, stat)] }, evidence: { pathRead: true, pathHash: hash(target), itemCount: 1 } };
    const limit = Math.max(1, Math.min(Number(payload.limit) || 100, 500));
    const items = fs.readdirSync(target, { withFileTypes: true }).slice(0, limit).map(entry => {
        const fullPath = path.join(target, entry.name);
        try { return fileInfo(fullPath, fs.statSync(fullPath)); } catch { return { name: entry.name, path: fullPath, kind: entry.isDirectory() ? 'folder' : 'file', unavailable: true }; }
    });
    return { result: { path: target, items }, evidence: { pathRead: true, pathHash: hash(target), itemCount: items.length } };
}

function searchFiles(payload, context = {}) {
    const query = String(payload.query || payload.name || '').trim().toLowerCase();
    if (!query) throw coded('desktop_search_query_required');
    const root = allowedPath(payload.root || payload.path, context.allowedFolders, context.fullFilesystemAccess);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw coded('desktop_search_root_invalid');
    const limit = Math.max(1, Math.min(Number(payload.limit) || 50, 200));
    const maxDepth = Math.max(0, Math.min(Number(payload.maxDepth) || 6, 12));
    const queue = [{ directory: root, depth: 0 }], matches = [];
    let inspected = 0;
    while (queue.length && matches.length < limit && inspected < 10000) {
        const current = queue.shift();
        let entries = [];
        try { entries = fs.readdirSync(current.directory, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
            inspected += 1;
            const fullPath = path.join(current.directory, entry.name);
            if (entry.name.toLowerCase().includes(query)) {
                try { matches.push(fileInfo(fullPath, fs.statSync(fullPath))); } catch { /* Permission changed during scan. */ }
                if (matches.length >= limit) break;
            }
            if (entry.isDirectory() && !entry.isSymbolicLink() && current.depth < maxDepth) queue.push({ directory: fullPath, depth: current.depth + 1 });
            if (inspected >= 10000) break;
        }
    }
    return { result: { root, query, items: matches, truncated: queue.length > 0 || inspected >= 10000 }, evidence: { searchCompleted: true, rootHash: hash(root), inspected, itemCount: matches.length } };
}

function discoverPrograms(payload, context = {}) {
    if (process.platform !== 'win32') throw coded('desktop_platform_not_supported');
    const query = String(payload.query || '').trim().toLowerCase();
    const standard = [
        process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : null,
        path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    ].filter(Boolean);
    const roots = context.fullProgramAccess === true
        ? [...standard, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)
        : standard;
    const items = [], queue = roots.map(directory => ({ directory, depth: 0 }));
    let inspected = 0;
    while (queue.length && items.length < 200 && inspected < 6000) {
        const current = queue.shift(); let entries = [];
        try { entries = fs.readdirSync(current.directory, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
            inspected += 1; const fullPath = path.join(current.directory, entry.name); const ext = path.extname(entry.name).toLowerCase();
            if (entry.isDirectory() && current.depth < 5) queue.push({ directory: fullPath, depth: current.depth + 1 });
            if (entry.isFile() && ['.lnk', '.exe', '.com'].includes(ext) && (!query || entry.name.toLowerCase().includes(query))) items.push({ name: path.basename(entry.name, ext), path: fullPath, kind: ext === '.lnk' ? 'shortcut' : 'program' });
            if (items.length >= 200 || inspected >= 6000) break;
        }
    }
    return { result: { query, items, scope: context.fullProgramAccess === true ? 'all_installed' : 'start_menu' }, evidence: { discoveryCompleted: true, inspected, itemCount: items.length } };
}

function fileInfo(fullPath, stat) {
    return { name: path.basename(fullPath), path: fullPath, kind: stat.isDirectory() ? 'folder' : 'file', size: stat.isFile() ? stat.size : null, modifiedAt: stat.mtime.toISOString() };
}

function normalizedRoots(values) {
    const defaults = [path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'Documents'), path.join(os.homedir(), 'Desktop')];
    return [...new Set((Array.isArray(values) && values.length ? values : defaults).map(value => path.resolve(String(value))))];
}
function allowedPath(value, configuredRoots, fullFilesystemAccess = false) {
    const raw = String(value || '');
    if (!raw || !path.isAbsolute(raw)) throw coded('desktop_absolute_path_required');
    const target = path.resolve(raw);
    if (fullFilesystemAccess === true) return target;
    const allowed = normalizedRoots(configuredRoots).some(root => target === root || target.startsWith(root + path.sep));
    if (!allowed) throw coded('desktop_path_not_allowed');
    return target;
}
function normalizeName(value) { return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_'); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function coded(code) { const error = new Error(code); error.code = code; return error; }
function unavailable(code) { throw coded(code); }

module.exports = {
    execute, allowedPath, latestDownload, listPath, searchFiles, discoverPrograms,
    mediaControl, uiControl, sanitizeUiRequest, runWindowsAutomation, WINDOWS_APPS, MEDIA_ACTIONS, UI_ACTIONS, UI_SHORTCUTS
};
