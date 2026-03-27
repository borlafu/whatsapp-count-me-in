import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import * as qrcode from 'qrcode';
import { handleCommand } from './commands.js';
import type { Message } from 'whatsapp-web.js';
import fs from 'fs';
import path from 'path';

// Cleanup all Chromium lock files from previous unclean shutdowns
const sessionDir = path.join(process.cwd(), '.wwebjs_auth', 'session');
if (fs.existsSync(sessionDir)) {
    ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(file => {
        const lockFile = path.join(sessionDir, file);
        if (fs.existsSync(lockFile)) {
            try {
                fs.unlinkSync(lockFile);
                console.log(`Cleaned up residual Chromium lock file: ${file}`);
            } catch (err) {
                console.error(`Failed to clean up lock file ${file}:`, err);
            }
        }
    });
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
    }
});

client.on('qr', async (qr: string) => {
    console.log('Scan this QR code with your WhatsApp app:');
    try {
        console.log(await qrcode.toString(qr, { type: 'terminal', small: true }));
    } catch (err) {
        console.error('Failed to generate QR code:', err);
        console.log('Raw QR data:', qr);
    }
});

client.on('ready', () => {
    console.log('WhatsApp Count Me In is ready!');
});

client.on('message', async (msg: Message) => {
    try {
        await handleCommand(msg, client);
    } catch (err) {
        console.error('Error handling message:', err);
    }
});

client.initialize();
