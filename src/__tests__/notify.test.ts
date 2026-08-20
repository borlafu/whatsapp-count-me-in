import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompositeNotifier } from '../notify/CompositeNotifier.js';
import { TelegramNotifier } from '../notify/TelegramNotifier.js';
import { EmailNotifier, type MailTransport, type SmtpConfig } from '../notify/EmailNotifier.js';
import { createNotifierFromEnv, NotifierConfigError } from '../notify/config.js';
import type { Alert, Notifier } from '../notify/Notifier.js';

const alert: Alert = { subject: 'Subject', body: 'Body line' };
const alertWithPng: Alert = {
  ...alert,
  attachment: { filename: 'qr.png', mime: 'image/png', data: Buffer.from([1, 2, 3]) },
};

describe('CompositeNotifier', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers to every channel', async () => {
    const first: Notifier = { send: vi.fn(async () => {}) };
    const second: Notifier = { send: vi.fn(async () => {}) };

    await new CompositeNotifier([first, second]).send(alert);

    expect(first.send).toHaveBeenCalledWith(alert);
    expect(second.send).toHaveBeenCalledWith(alert);
  });

  it('keeps delivering when one channel throws, and never rethrows', async () => {
    const broken: Notifier = { send: vi.fn(async () => { throw new Error('smtp down'); }) };
    const working: Notifier = { send: vi.fn(async () => {}) };

    await expect(new CompositeNotifier([broken, working]).send(alert)).resolves.toBeUndefined();
    expect(working.send).toHaveBeenCalledTimes(1);
  });
});

describe('TelegramNotifier', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function okResponse() {
    return { ok: true, status: 200, text: async () => '{"ok":true}' } as Response;
  }

  it('posts text alerts to sendMessage', async () => {
    const fetchFn = vi.fn(async () => okResponse());
    await new TelegramNotifier({ botToken: 'TOKEN', chatId: '42' }, fetchFn as unknown as typeof fetch).send(alert);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    expect(init.method).toBe('POST');
    const body = init.body as URLSearchParams;
    expect(body.get('chat_id')).toBe('42');
    expect(body.get('text')).toContain('Body line');
  });

  it('posts image alerts to sendPhoto as multipart', async () => {
    const fetchFn = vi.fn(async () => okResponse());
    await new TelegramNotifier({ botToken: 'TOKEN', chatId: '42' }, fetchFn as unknown as typeof fetch)
      .send(alertWithPng);

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botTOKEN/sendPhoto');
    const form = init.body as FormData;
    expect(form.get('chat_id')).toBe('42');
    expect(form.get('photo')).toBeInstanceOf(Blob);
  });

  it('logs and swallows a non-2xx response', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => '{"description":"chat not found"}',
    }) as Response);

    await expect(
      new TelegramNotifier({ botToken: 'TOKEN', chatId: '42' }, fetchFn as unknown as typeof fetch).send(alert),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('logs and swallows a network failure', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('ECONNRESET'); });

    await expect(
      new TelegramNotifier({ botToken: 'TOKEN', chatId: '42' }, fetchFn as unknown as typeof fetch).send(alert),
    ).resolves.toBeUndefined();
  });
});

describe('EmailNotifier', () => {
  const config: SmtpConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    from: 'bot@example.com',
    to: 'me@example.com',
  };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends subject, body, and attachment', async () => {
    const transport: MailTransport = { sendMail: vi.fn(async () => ({})) };

    await new EmailNotifier(config, transport).send(alertWithPng);

    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'bot@example.com',
      to: 'me@example.com',
      subject: 'Subject',
      text: 'Body line',
      attachments: [{ filename: 'qr.png', content: alertWithPng.attachment!.data, contentType: 'image/png' }],
    });
  });

  it('omits attachments when there is none', async () => {
    const transport: MailTransport = { sendMail: vi.fn(async () => ({})) };

    await new EmailNotifier(config, transport).send(alert);

    const options = (transport.sendMail as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0];
    expect(options).not.toHaveProperty('attachments');
  });

  it('logs and swallows SMTP failures', async () => {
    const transport: MailTransport = { sendMail: vi.fn(async () => { throw new Error('535 auth failed'); }) };

    await expect(new EmailNotifier(config, transport).send(alert)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('createNotifierFromEnv', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to console-only when nothing is configured', () => {
    const notifier = createNotifierFromEnv({});
    expect(notifier).toBeDefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it('builds a composite when both channels are configured', () => {
    const notifier = createNotifierFromEnv({
      NOTIFY_TELEGRAM_BOT_TOKEN: 'TOKEN',
      NOTIFY_TELEGRAM_CHAT_ID: '42',
      NOTIFY_SMTP_HOST: 'smtp.example.com',
      NOTIFY_EMAIL_FROM: 'bot@example.com',
      NOTIFY_EMAIL_TO: 'me@example.com',
    });
    expect(notifier).toBeInstanceOf(CompositeNotifier);
  });

  it('rejects a half-configured Telegram channel', () => {
    expect(() => createNotifierFromEnv({ NOTIFY_TELEGRAM_BOT_TOKEN: 'TOKEN' }))
      .toThrow(NotifierConfigError);
  });

  it('rejects a half-configured email channel', () => {
    expect(() => createNotifierFromEnv({ NOTIFY_SMTP_HOST: 'smtp.example.com' }))
      .toThrow(/Missing: NOTIFY_EMAIL_FROM, NOTIFY_EMAIL_TO/);
  });

  it('rejects an invalid SMTP port', () => {
    expect(() =>
      createNotifierFromEnv({
        NOTIFY_SMTP_HOST: 'smtp.example.com',
        NOTIFY_SMTP_PORT: 'not-a-port',
        NOTIFY_EMAIL_FROM: 'bot@example.com',
        NOTIFY_EMAIL_TO: 'me@example.com',
      }),
    ).toThrow(/valid port number/);
  });

  it('ignores whitespace-only values', () => {
    const notifier = createNotifierFromEnv({ NOTIFY_TELEGRAM_BOT_TOKEN: '   ' });
    expect(notifier).toBeDefined();
    expect(console.warn).toHaveBeenCalled();
  });
});
