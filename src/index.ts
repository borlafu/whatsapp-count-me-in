import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, type WAMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode';
import fs from 'fs';
import { DatabaseManager } from './Database.js';
import { EventService } from './EventService.js';
import { CommandHandler } from './CommandHandler.js';

class WhatsAppBot {
  private db: DatabaseManager;
  private eventService: EventService;
  private commandHandler: CommandHandler;

  constructor() {
    this.db = new DatabaseManager();
    this.eventService = new EventService(this.db);
    this.commandHandler = new CommandHandler(this.eventService, this.db);
  }

  async start() {
    const { state, saveCreds } = await useMultiFileAuthState('.auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      auth: state,
      syncFullHistory: false,
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
        }
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('Connection closed due to ', lastDisconnect?.error?.message);
        if (shouldReconnect) {
          console.log('Reconnecting...');
          setTimeout(() => this.start(), 3000);
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
        await this.commandHandler.handleCommand(msg as WAMessage, sock);
      }
    });
  }
}

const bot = new WhatsAppBot();
bot.start().catch(err => {
  console.error('Unexpected error during startup:', err);
  process.exit(1);
});
