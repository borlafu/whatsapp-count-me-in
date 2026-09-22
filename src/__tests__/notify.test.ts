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

describe('CompositeNotifier.resolve', () => {
  it('fans out to channels that support it and skips the rest', async () => {
    const editing: Notifier = { send: vi.fn(async () => {}), resolve: vi.fn(async () => {}) };
    const plain: Notifier = { send: vi.fn(async () => {}) };

    await new CompositeNotifier([editing, plain]).resolve('k', { subject: 'S', body: 'B' });

    expect(editing.resolve).toHaveBeenCalledWith('k', { subject: 'S', body: 'B' });
  });

  it('never rethrows a failing resolve', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken: Notifier = { send: vi.fn(async () => {}), resolve: vi.fn(async () => { throw new Error('boom'); }) };

    await expect(new CompositeNotifier([broken]).resolve('k', { subject: 'S', body: 'B' })).resolves.toBeUndefined();
    vi.restoreAllMocks();
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
    // Markdown parsing would reject stack traces containing stray * or _.
    expect(body.get('parse_mode')).toBeNull();
  });

  it('truncates a message that exceeds the Telegram limit', async () => {
    const fetchFn = vi.fn(async () => okResponse());
    const stackTrace = 'at Object.<anonymous> (/app/dist/index.js:1:1)\n'.repeat(200);

    await new TelegramNotifier({ botToken: 'TOKEN', chatId: '42' }, fetchFn as unknown as typeof fetch)
      .send({ subject: 'WhatsApp bot crashed', body: stackTrace });

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const text = (init.body as URLSearchParams).get('text')!;
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text.endsWith('[truncated]')).toBe(true);
  });

  it('truncates a photo caption to the shorter caption limit', async () => {
    const fetchFn = vi.fn(async () => okResponse());

    await new TelegramNotifier({ botToken: 'TOKEN', chatId: '42' }, fetchFn as unknown as typeof fetch)
      .send({ ...alertWithPng, body: 'x'.repeat(2_000) });

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const caption = (init.body as FormData).get('caption') as string;
    expect(caption.length).toBeLessThanOrEqual(1024);
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

  function okResponseWithMessage(messageId: number) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, result: { message_id: messageId } }),
    } as Response;
  }

  function telegram(fetchFn: ReturnType<typeof vi.fn>) {
    return new TelegramNotifier({ botToken: 'TOKEN', chatId: '42' }, fetchFn as unknown as typeof fetch);
  }

  function callAt(fetchFn: ReturnType<typeof vi.fn>, index: number): [string, RequestInit] {
    return fetchFn.mock.calls[index] as unknown as [string, RequestInit];
  }

  it('adds a copy button when the alert carries copyable text', async () => {
    const fetchFn = vi.fn(async () => okResponse());

    await telegram(fetchFn).send({ ...alertWithPng, copyText: 'ABCD1234' });

    const [, init] = callAt(fetchFn, 0);
    const markup = JSON.parse((init.body as FormData).get('reply_markup') as string);
    expect(markup.inline_keyboard[0][0].copy_text).toEqual({ text: 'ABCD1234' });
  });

  it('sends no keyboard when there is nothing to copy', async () => {
    const fetchFn = vi.fn(async () => okResponse());

    await telegram(fetchFn).send(alertWithPng);

    const [, init] = callAt(fetchFn, 0);
    expect((init.body as FormData).get('reply_markup')).toBeNull();
  });

  it('edits the previous photo in place when alerts share a replace key', async () => {
    const fetchFn = vi.fn(async () => okResponseWithMessage(77));
    const notifier = telegram(fetchFn);

    await notifier.send({ ...alertWithPng, replaceKey: 'pairing:1', copyText: 'FIRST' });
    await notifier.send({ ...alertWithPng, body: 'Second body', replaceKey: 'pairing:1', copyText: 'SECOND' });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [url, init] = callAt(fetchFn, 1);
    expect(url).toBe('https://api.telegram.org/botTOKEN/editMessageMedia');
    const form = init.body as FormData;
    expect(form.get('message_id')).toBe('77');
    const media = JSON.parse(form.get('media') as string);
    expect(media.type).toBe('photo');
    expect(media.media).toBe('attach://photo');
    expect(media.caption).toContain('Second body');
    expect(form.get('photo')).toBeInstanceOf(Blob);
    const markup = JSON.parse(form.get('reply_markup') as string);
    expect(markup.inline_keyboard[0][0].copy_text).toEqual({ text: 'SECOND' });
  });

  it('edits the previous text message in place for text-only alerts', async () => {
    const fetchFn = vi.fn(async () => okResponseWithMessage(5));
    const notifier = telegram(fetchFn);

    await notifier.send({ ...alert, replaceKey: 'k' });
    await notifier.send({ ...alert, body: 'Updated', replaceKey: 'k' });

    const [url, init] = callAt(fetchFn, 1);
    expect(url).toBe('https://api.telegram.org/botTOKEN/editMessageText');
    const body = init.body as URLSearchParams;
    expect(body.get('message_id')).toBe('5');
    expect(body.get('text')).toContain('Updated');
  });

  it('posts a fresh message when keys differ', async () => {
    const fetchFn = vi.fn(async () => okResponseWithMessage(1));
    const notifier = telegram(fetchFn);

    await notifier.send({ ...alertWithPng, replaceKey: 'pairing:1' });
    await notifier.send({ ...alertWithPng, replaceKey: 'pairing:2' });

    expect(callAt(fetchFn, 1)[0]).toBe('https://api.telegram.org/botTOKEN/sendPhoto');
  });

  it('falls back to a fresh message when the edit is rejected, then tracks the new one', async () => {
    const responses = [
      okResponseWithMessage(10),
      { ok: false, status: 400, text: async () => '{"description":"Bad Request: message to edit not found"}' } as Response,
      okResponseWithMessage(11),
      okResponseWithMessage(11),
    ];
    const fetchFn = vi.fn(async () => responses.shift()!);
    const notifier = telegram(fetchFn);

    await notifier.send({ ...alertWithPng, replaceKey: 'k' });
    await notifier.send({ ...alertWithPng, replaceKey: 'k' });
    await notifier.send({ ...alertWithPng, replaceKey: 'k' });

    expect(fetchFn.mock.calls.map(c => (c as unknown as [string])[0].split('/').pop())).toEqual([
      'sendPhoto',
      'editMessageMedia',
      'sendPhoto',
      'editMessageMedia',
    ]);
    const [, init] = callAt(fetchFn, 3);
    expect((init.body as FormData).get('message_id')).toBe('11');
  });

  it('clears the keyboard when an edited alert no longer has anything to copy', async () => {
    const fetchFn = vi.fn(async () => okResponseWithMessage(4));
    const notifier = telegram(fetchFn);

    await notifier.send({ ...alertWithPng, replaceKey: 'k', copyText: 'CODE' });
    await notifier.send({ ...alertWithPng, replaceKey: 'k' });

    const [, init] = callAt(fetchFn, 1);
    expect(JSON.parse((init.body as FormData).get('reply_markup') as string)).toEqual({ inline_keyboard: [] });
  });

  it('warns when Telegram returns no message id for a keyed alert', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = vi.fn(async () => okResponse());

    await telegram(fetchFn).send({ ...alert, replaceKey: 'k' });

    expect(console.warn).toHaveBeenCalled();
  });

  it('treats "message is not modified" as a successful edit', async () => {
    const responses = [
      okResponseWithMessage(10),
      { ok: false, status: 400, text: async () => '{"description":"Bad Request: message is not modified"}' } as Response,
    ];
    const fetchFn = vi.fn(async () => responses.shift()!);
    const notifier = telegram(fetchFn);

    await notifier.send({ ...alert, replaceKey: 'k' });
    await notifier.send({ ...alert, replaceKey: 'k' });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('resolves a tracked photo by rewriting its caption and dropping the keyboard', async () => {
    const fetchFn = vi.fn(async () => okResponseWithMessage(9));
    const notifier = telegram(fetchFn);

    await notifier.send({ ...alertWithPng, replaceKey: 'k', copyText: 'CODE' });
    await notifier.resolve('k', { subject: 'Done', body: 'Linked.' });

    const [url, init] = callAt(fetchFn, 1);
    expect(url).toBe('https://api.telegram.org/botTOKEN/editMessageCaption');
    const body = init.body as URLSearchParams;
    expect(body.get('message_id')).toBe('9');
    expect(body.get('caption')).toBe('Done\n\nLinked.');
    expect(JSON.parse(body.get('reply_markup')!)).toEqual({ inline_keyboard: [] });
  });

  it('resolves a tracked text message through editMessageText', async () => {
    const fetchFn = vi.fn(async () => okResponseWithMessage(3));
    const notifier = telegram(fetchFn);

    await notifier.send({ ...alert, replaceKey: 'k' });
    await notifier.resolve('k', { subject: 'Done', body: 'Linked.' });

    expect(callAt(fetchFn, 1)[0]).toBe('https://api.telegram.org/botTOKEN/editMessageText');
  });

  it('ignores resolve for an unknown key and forgets a key once resolved', async () => {
    const fetchFn = vi.fn(async () => okResponseWithMessage(3));
    const notifier = telegram(fetchFn);

    await notifier.resolve('nope', { subject: 'Done', body: 'x' });
    expect(fetchFn).not.toHaveBeenCalled();

    await notifier.send({ ...alert, replaceKey: 'k' });
    await notifier.resolve('k', { subject: 'Done', body: 'x' });
    await notifier.send({ ...alert, replaceKey: 'k' });

    expect(callAt(fetchFn, 2)[0]).toBe('https://api.telegram.org/botTOKEN/sendMessage');
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

  it('accepts a Telegram-only setup copied from .env.example', () => {
    // .env.example ships PORT and SECURE pre-filled; they must not count as
    // "email was configured", or the bot would refuse to start.
    const notifier = createNotifierFromEnv({
      WA_PHONE_NUMBER: '34600111222',
      NOTIFY_TELEGRAM_BOT_TOKEN: 'TOKEN',
      NOTIFY_TELEGRAM_CHAT_ID: '42',
      NOTIFY_SMTP_PORT: '587',
      NOTIFY_SMTP_SECURE: 'false',
      NOTIFY_SMTP_HOST: '',
      NOTIFY_EMAIL_FROM: '',
      NOTIFY_EMAIL_TO: '',
    });
    expect(notifier).toBeInstanceOf(CompositeNotifier);
  });

  it('accepts an untouched .env.example with no channel at all', () => {
    expect(() => createNotifierFromEnv({ NOTIFY_SMTP_PORT: '587', NOTIFY_SMTP_SECURE: 'false' }))
      .not.toThrow();
  });

  it('rejects an SMTP user without a password', () => {
    expect(() =>
      createNotifierFromEnv({
        NOTIFY_SMTP_HOST: 'smtp.example.com',
        NOTIFY_SMTP_USER: 'bot@example.com',
        NOTIFY_EMAIL_FROM: 'bot@example.com',
        NOTIFY_EMAIL_TO: 'me@example.com',
      }),
    ).toThrow(/Missing: NOTIFY_SMTP_PASS/);
  });

  it.each(['TRUE', '1', 'yes', 'on'])('accepts %s as a secure flag', value => {
    expect(() =>
      createNotifierFromEnv({
        NOTIFY_SMTP_HOST: 'smtp.example.com',
        NOTIFY_SMTP_SECURE: value,
        NOTIFY_EMAIL_FROM: 'bot@example.com',
        NOTIFY_EMAIL_TO: 'me@example.com',
      }),
    ).not.toThrow();
  });

  it('rejects an unrecognised secure flag rather than silently using plaintext', () => {
    expect(() =>
      createNotifierFromEnv({
        NOTIFY_SMTP_HOST: 'smtp.example.com',
        NOTIFY_SMTP_SECURE: 'ssl',
        NOTIFY_EMAIL_FROM: 'bot@example.com',
        NOTIFY_EMAIL_TO: 'me@example.com',
      }),
    ).toThrow(NotifierConfigError);
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
