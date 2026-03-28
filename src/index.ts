import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { handleCommand } from './commands.js';
import pino from 'pino';
import * as qrcode from 'qrcode';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('.auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        syncFullHistory: false, // Save memory
        generateHighQualityLinkPreview: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Scan this QR code with your WhatsApp app:');
            try {
                console.log(await qrcode.toString(qr, { type: 'terminal', small: true }));
            } catch (err) {
                console.error('Failed to generate QR code:', err);
                console.log('Raw QR data:', qr);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect?.error?.message);
            if (shouldReconnect) {
                console.log('Reconnecting...');
                // Wait a bit before reconnecting
                setTimeout(connectToWhatsApp, 3000);
            } else {
                console.log('Logged out. Please delete .auth_info_baileys and restart to re-authenticate.');
                process.exit(0);
            }
        } else if (connection === 'open') {
            console.log('WhatsApp Count Me In is ready!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        for (const msg of m.messages) {
            if (!msg.message) continue;

            try {
                await handleCommand(msg, sock);
            } catch (err) {
                console.error('Error handling message:', err);
            }
        }
    });
}

// Cleanup wwebjs auth just in case the user forgets
import fs from 'fs';
if (fs.existsSync('.wwebjs_auth')) {
    console.log('Found old wwebjs_auth directory. You can delete it manually to save space.');
}

connectToWhatsApp();
