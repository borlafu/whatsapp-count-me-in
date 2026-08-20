import type { Notifier } from './Notifier.js';
import { CompositeNotifier } from './CompositeNotifier.js';
import { ConsoleNotifier } from './ConsoleNotifier.js';
import { TelegramNotifier } from './TelegramNotifier.js';
import { EmailNotifier, createSmtpTransport, type SmtpConfig } from './EmailNotifier.js';

const DEFAULT_SMTP_PORT = 587;

export class NotifierConfigError extends Error {}

type Env = Record<string, string | undefined>;

function read(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function requireAll(env: Env, keys: string[], channel: string): void {
  const missing = keys.filter(key => !read(env, key));
  if (missing.length > 0) {
    throw new NotifierConfigError(
      `${channel} alerts are partially configured. Missing: ${missing.join(', ')}. ` +
        `Set all of them or none.`,
    );
  }
}

function buildTelegram(env: Env): Notifier | null {
  const token = read(env, 'NOTIFY_TELEGRAM_BOT_TOKEN');
  const chatId = read(env, 'NOTIFY_TELEGRAM_CHAT_ID');
  if (!token && !chatId) return null;

  requireAll(env, ['NOTIFY_TELEGRAM_BOT_TOKEN', 'NOTIFY_TELEGRAM_CHAT_ID'], 'Telegram');
  return new TelegramNotifier({ botToken: token!, chatId: chatId! });
}

function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_SMTP_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new NotifierConfigError(`NOTIFY_SMTP_PORT must be a valid port number, got "${raw}".`);
  }
  return port;
}

function buildEmail(env: Env): Notifier | null {
  const emailKeys = [
    'NOTIFY_SMTP_HOST',
    'NOTIFY_SMTP_PORT',
    'NOTIFY_SMTP_SECURE',
    'NOTIFY_SMTP_USER',
    'NOTIFY_SMTP_PASS',
    'NOTIFY_EMAIL_FROM',
    'NOTIFY_EMAIL_TO',
  ];
  if (!emailKeys.some(key => read(env, key))) return null;

  requireAll(env, ['NOTIFY_SMTP_HOST', 'NOTIFY_EMAIL_FROM', 'NOTIFY_EMAIL_TO'], 'Email');

  const config: SmtpConfig = {
    host: read(env, 'NOTIFY_SMTP_HOST')!,
    port: parsePort(read(env, 'NOTIFY_SMTP_PORT')),
    secure: read(env, 'NOTIFY_SMTP_SECURE') === 'true',
    from: read(env, 'NOTIFY_EMAIL_FROM')!,
    to: read(env, 'NOTIFY_EMAIL_TO')!,
    ...(read(env, 'NOTIFY_SMTP_USER') ? { user: read(env, 'NOTIFY_SMTP_USER')! } : {}),
    ...(read(env, 'NOTIFY_SMTP_PASS') ? { pass: read(env, 'NOTIFY_SMTP_PASS')! } : {}),
  };
  return new EmailNotifier(config, createSmtpTransport(config));
}

/**
 * Builds the notifier from environment variables, validating at startup so a
 * half-configured channel fails fast instead of silently swallowing alerts.
 * Falls back to console-only logging when nothing is configured.
 */
export function createNotifierFromEnv(env: Env = process.env): Notifier {
  const channels = [buildTelegram(env), buildEmail(env)].filter((c): c is Notifier => c !== null);

  if (channels.length === 0) {
    console.warn(
      'No alert channel configured (Telegram / SMTP). Re-link instructions will only be printed ' +
        'to the log. See .env.example.',
    );
    return new ConsoleNotifier();
  }
  return new CompositeNotifier(channels);
}
