/* =============================================
   WhatsApp Client Manager (Baileys)
   -------------------------------------------------
   Singleton manager del socket de Baileys.
   - Sesión persistente en disco
   - Reconexión automática
   - QR como data URL
   - Procesa mensajes entrantes vía handler.js
   ============================================= */

const path = require('path');
const fs = require('fs');
const pino = require('pino');
const QR = require('qrcode');
const store = require('./message-log');
const handler = require('./handler');

const SESSION_DIR = path.join(__dirname, '..', '..', 'whatsapp-session');

let sock = null;
let state = 'disconnected'; // 'disconnected' | 'qr_ready' | 'connecting' | 'connected' | 'error'
let currentQr = null;       // data URL
let currentQrRaw = null;    // original string
let myPhone = null;
let reconnectAttempt = 0;
let manuallyDisconnected = false;
let lastError = null;
let authStateSaver = null;

// Lazy-load Baileys (ESM-interop)
let baileys = null;
async function loadBaileys() {
    if (baileys) return baileys;
    baileys = await import('@whiskeysockets/baileys');
    return baileys;
}

async function ensureConnection() {
    if (sock || state === 'connecting') return;
    manuallyDisconnected = false;
    await start();
}

async function start() {
    state = 'connecting';
    lastError = null;
    try {
        if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
        const B = await loadBaileys();
        const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = B;

        const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        authStateSaver = saveCreds;
        const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1023223821] }));

        sock = makeWASocket({
            version,
            auth: authState,
            logger: pino({ level: 'silent' }),
            browser: Browsers.appropriate('Gunter'),
            markOnlineOnConnect: false,
            emitOwnEvents: false,
            syncFullHistory: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                try {
                    currentQrRaw = qr;
                    currentQr = await QR.toDataURL(qr, { width: 320, margin: 1, errorCorrectionLevel: 'M' });
                    state = 'qr_ready';
                    console.log('📱 WhatsApp QR disponible — escanéalo desde /api/whatsapp/qr');
                } catch (e) {
                    console.error('[wa] QR render error:', e.message);
                }
            }

            if (connection === 'open') {
                state = 'connected';
                currentQr = null;
                currentQrRaw = null;
                reconnectAttempt = 0;
                myPhone = sock.user?.id?.split(':')?.[0]?.split('@')?.[0] || sock.user?.id || null;
                console.log(`✅ WhatsApp conectado como ${myPhone}`);
            }

            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                const loggedOut = code === DisconnectReason.loggedOut;
                console.log(`⚠️  WhatsApp desconectado (code=${code})${loggedOut ? ' — sesión cerrada' : ''}`);
                lastError = lastDisconnect?.error?.message || null;
                sock = null;

                if (loggedOut) {
                    state = 'disconnected';
                    try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
                    return;
                }
                if (manuallyDisconnected) { state = 'disconnected'; return; }
                // Reconnect with backoff
                reconnectAttempt++;
                const delay = Math.min(30000, 2000 * reconnectAttempt);
                state = 'connecting';
                setTimeout(() => start().catch(e => { state = 'error'; lastError = e.message; }), delay);
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const m of messages) {
                if (m.key.fromMe) continue;
                if (!m.message) continue;

                const from = m.key.remoteJid;
                const phone = from.split('@')[0];
                const ts = new Date((m.messageTimestamp || 0) * 1000 || Date.now()).toISOString();

                try {
                    let reply = '';
                    let ignored = false;

                    // Audio (PTT / audio)
                    if (m.message.audioMessage) {
                        const buffer = await downloadMedia(m, 'audio');
                        const mime = m.message.audioMessage.mimetype || 'audio/ogg';
                        store.appendMessage({ direction: 'in', from: phone, text: '🎙 [audio]', id: m.key.id, timestamp: ts });
                        const res = await handler.handleAudioMessage(buffer, mime, { from: phone });
                        reply = res.reply; ignored = !!res.ignored;

                    // Imagen
                    } else if (m.message.imageMessage) {
                        const buffer = await downloadMedia(m, 'image');
                        const mime = m.message.imageMessage.mimetype || 'image/jpeg';
                        const caption = m.message.imageMessage.caption || '';
                        store.appendMessage({
                            direction: 'in', from: phone,
                            text: caption ? `📷 [imagen] ${caption}` : '📷 [imagen]',
                            id: m.key.id, timestamp: ts
                        });
                        const res = await handler.handleImageMessage(buffer, mime, caption, { from: phone });
                        reply = res.reply; ignored = !!res.ignored;

                    // Texto
                    } else {
                        const text = extractText(m);
                        if (!text) continue;
                        store.appendMessage({ direction: 'in', from: phone, text, id: m.key.id, timestamp: ts });
                        const res = await handler.handle(text, { from: phone });
                        reply = res.reply; ignored = !!res.ignored;
                    }

                    if (reply && !ignored) {
                        await sock.sendMessage(from, { text: reply });
                        store.appendMessage({
                            direction: 'out', to: phone, from: myPhone, text: reply,
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (e) {
                    console.error('[wa] handler error:', e);
                }
            }
        });
    } catch (err) {
        state = 'error';
        lastError = err.message || String(err);
        console.error('[wa] start() failed:', err);
    }
}

async function downloadMedia(m, type) {
    const B = await loadBaileys();
    // Baileys exposes downloadMediaMessage as named export
    const { downloadMediaMessage } = B;
    if (!downloadMediaMessage) throw new Error('downloadMediaMessage not available');
    const buffer = await downloadMediaMessage(m, 'buffer', {}, {
        logger: pino({ level: 'silent' }),
        reuploadRequest: sock?.updateMediaMessage
    });
    return buffer;
}

function extractText(m) {
    const msg = m.message || {};
    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        msg.buttonsResponseMessage?.selectedDisplayText ||
        msg.listResponseMessage?.title ||
        ''
    );
}

async function sendMessage(toPhone, text) {
    if (!sock || state !== 'connected') throw new Error('WhatsApp no está conectado');
    const jid = toPhone.includes('@') ? toPhone : `${toPhone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    const res = await sock.sendMessage(jid, { text });
    store.appendMessage({
        direction: 'out', to: toPhone, from: myPhone, text,
        timestamp: new Date().toISOString()
    });
    return res;
}

async function disconnect() {
    manuallyDisconnected = true;
    try { if (sock) await sock.logout().catch(() => {}); } catch {}
    try { if (sock) sock.end(undefined); } catch {}
    sock = null;
    state = 'disconnected';
    currentQr = null;
    currentQrRaw = null;
    try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
}

function getStatus() {
    return {
        state,
        phone: myPhone,
        qrAvailable: !!currentQr,
        error: lastError
    };
}

function getQR() {
    return { qr: currentQr, raw: currentQrRaw, state };
}

module.exports = {
    start: ensureConnection,
    disconnect,
    sendMessage,
    getStatus,
    getQR,
    SESSION_DIR
};
