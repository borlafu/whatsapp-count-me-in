import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  type AuthenticationState,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { DatabaseManager } from './Database.js';
import { EventService } from './EventService.js';
import { CommandHandler } from './CommandHandler.js';
import { Scheduler } from './Scheduler.js';
import { ConnectionManager } from './connection/ConnectionManager.js';
import { wipeAuthState } from './connection/authState.js';
import { createNotifierFromEnv, NotifierConfigError } from './notify/config.js';
import type { Notifier } from './notify/Notifier.js';

const AUTH_DIR = '.auth_info_baileys';
const PHONE_NUMBER_PATTERN = /^\d{8,15}$/;

/** Reads WA_PHONE_NUMBER, which enables pairing-code delivery alongside the QR code. */
function readPhoneNumber(): string | undefined {
  const raw = process.env['WA_PHONE_NUMBER']?.replace(/[\s+()-]/g, '') ?? '';
  if (!raw) return undefined;
  if (!PHONE_NUMBER_PATTERN.test(raw)) {
    console.warn(
      `WA_PHONE_NUMBER "${raw}" is not a plain international number (digits only, country code, ` +
        'no "+"). Pairing codes are disabled; QR codes will still be sent.',
    );
    return undefined;
  }
  return raw;
}

class WhatsAppBot {
  private db: DatabaseManager;
  private eventService: EventService;
  private commandHandler: CommandHandler;
  private contactNames: Map<string, string> = new Map();
  private scheduler: Scheduler | null = null;
  private connection: ConnectionManager;

  constructor(private notifier: Notifier) {
    this.db = new DatabaseManager();
    this.eventService = new EventService(this.db);
    this.commandHandler = new CommandHandler(this.eventService, this.db, this.contactNames);

    this.connection = new ConnectionManager({
      authState: {
        load: () => useMultiFileAuthState(AUTH_DIR),
        wipe: () => wipeAuthState(AUTH_DIR),
      },
      createSocket: state => this.createSocket(state),
      wireAppEvents: sock => this.wireAppEvents(sock),
      onOpen: sock => this.startScheduler(sock),
      onClose: () => this.stopScheduler(),
      notifier: this.notifier,
      phoneNumber: readPhoneNumber(),
    });
  }

  start(): Promise<void> {
    return this.connection.start();
  }

  private async createSocket(auth: AuthenticationState): Promise<WASocket> {
    const { version } = await fetchLatestBaileysVersion();
    return makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      auth,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
    });
  }

  private wireAppEvents(sock: WASocket): void {
    sock.ev.on('contacts.upsert', contacts => {
      for (const c of contacts) {
        const id = jidNormalizedUser(c.id);
        if (c.notify) this.contactNames.set(id, c.notify);
      }
    });

    sock.ev.on('contacts.update', updates => {
      for (const c of updates) {
        if (c.id && c.notify) {
          this.contactNames.set(jidNormalizedUser(c.id), c.notify);
        }
      }
    });

    sock.ev.on('messages.upsert', async m => {
      if (m.type !== 'notify') return;
      for (const msg of m.messages) {
        if (!msg.message) continue;
        await this.commandHandler.handleCommand(msg as WAMessage, sock);
      }
    });
  }

  private startScheduler(sock: WASocket): void {
    this.scheduler = new Scheduler(
      this.db,
      this.eventService,
      async (chatId, text) => { await sock.sendMessage(chatId, { text }); },
      chatId => this.db.getLocale(chatId),
    );
    this.scheduler.start();
  }

  private stopScheduler(): void {
    this.scheduler?.stop();
    this.scheduler = null;
  }
}

const CRASH_ALERT_TIMEOUT_MS = 10_000;

function installCrashHandlers(notifier: Notifier): void {
  const report = (label: string, err: unknown) => {
    console.error(`${label}:`, err);
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    const alert = notifier
      .send({ subject: 'WhatsApp bot crashed', body: `${label}:\n\n${detail}` })
      .catch(sendErr => console.error('Failed to report crash:', sendErr));
    // Exit even if a channel hangs, so the process manager can restart us.
    const timeout = new Promise(resolve => setTimeout(resolve, CRASH_ALERT_TIMEOUT_MS).unref());
    Promise.race([alert, timeout]).finally(() => process.exit(1));
  };

  process.on('unhandledRejection', reason => report('Unhandled promise rejection', reason));
  process.on('uncaughtException', err => report('Uncaught exception', err));
}

let notifier: Notifier;
try {
  notifier = createNotifierFromEnv();
} catch (err) {
  if (err instanceof NotifierConfigError) {
    console.error(`Invalid alert configuration: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

installCrashHandlers(notifier);

const bot = new WhatsAppBot(notifier);
bot.start().catch(err => {
  console.error('Unexpected error during startup:', err);
  process.exit(1);
});
