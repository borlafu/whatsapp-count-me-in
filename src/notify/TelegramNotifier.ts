import type { Alert, AlertAttachment, AlertResolution, Notifier } from './Notifier.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 15_000;
/** Telegram rejects anything longer, which would silently lose the alert. */
const MAX_MESSAGE_LENGTH = 4096;
const MAX_CAPTION_LENGTH = 1024;
const TRUNCATION_SUFFIX = '\n[truncated]';
const COPY_BUTTON_LABEL = 'Copy pairing code';
/** Telegram answers an edit that changes nothing with this 400; it is not a failure. */
const NOT_MODIFIED_MARKER = 'message is not modified';
/** Multipart field name the media descriptor points at via `attach://`. */
const PHOTO_FIELD = 'photo';

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

function formatText(alert: Pick<Alert, 'subject' | 'body'>): string {
  // Sent as plain text on purpose: alert bodies contain stack traces and raw
  // error messages, and any stray Markdown character would make Telegram
  // reject the whole request.
  return `${alert.subject}\n\n${alert.body}`;
}

function copyKeyboard(copyText: string | undefined): string | null {
  if (!copyText) return null;
  return JSON.stringify({
    inline_keyboard: [[{ text: COPY_BUTTON_LABEL, copy_text: { text: copyText } }]],
  });
}

/** Edits always state the keyboard explicitly, so a stale copy button can never survive. */
function editKeyboard(copyText: string | undefined): string {
  return copyKeyboard(copyText) ?? JSON.stringify({ inline_keyboard: [] });
}

function toBlob(attachment: AlertAttachment): Blob {
  // Buffer is a Uint8Array view; copy into a plain view so Blob accepts it.
  return new Blob([new Uint8Array(attachment.data)], { type: attachment.mime });
}

function extractMessageId(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw) as { result?: { message_id?: unknown } };
    const id = parsed.result?.message_id;
    return typeof id === 'number' ? id : null;
  } catch {
    return null;
  }
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

interface TrackedMessage {
  messageId: number;
  hasMedia: boolean;
}

/**
 * Sends alerts through the Telegram Bot API using the global fetch/FormData
 * available on Node >= 24, so no extra dependency is needed.
 *
 * Alerts with a `replaceKey` are remembered by message id and edited in place
 * on the next send, so a rotating pairing code updates one chat message
 * instead of piling up. Edits are silent on the operator's phone; only the
 * first message of a key pushes a notification.
 */
export class TelegramNotifier implements Notifier {
  private tracked: Readonly<Record<string, TrackedMessage>> = {};

  constructor(
    private config: TelegramConfig,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async send(alert: Alert): Promise<void> {
    try {
      const previous = alert.replaceKey ? this.tracked[alert.replaceKey] : undefined;
      if (previous && (await this.tryEdit(previous, alert))) return;

      const messageId = alert.attachment
        ? await this.sendPhoto(alert, alert.attachment)
        : await this.sendMessage(alert);
      this.remember(alert.replaceKey, messageId, alert.attachment !== undefined);
    } catch (err) {
      console.error('Telegram alert failed:', err instanceof Error ? err.message : err);
    }
  }

  async resolve(replaceKey: string, resolution: AlertResolution): Promise<void> {
    const previous = this.tracked[replaceKey];
    if (!previous) return;
    this.forget(replaceKey);
    try {
      await this.editText(previous, resolution, undefined);
    } catch (err) {
      console.error('Telegram alert resolve failed:', err instanceof Error ? err.message : err);
    }
  }

  /** Returns false when the message cannot be edited, so the caller sends afresh. */
  private async tryEdit(previous: TrackedMessage, alert: Alert): Promise<boolean> {
    // Telegram cannot turn a text message into a photo message.
    if (alert.attachment && !previous.hasMedia) return false;
    try {
      if (alert.attachment) {
        await this.editMedia(previous, alert, alert.attachment);
      } else {
        await this.editText(previous, alert, alert.copyText);
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes(NOT_MODIFIED_MARKER)) return true;
      console.error('Telegram edit failed, sending a new message instead:', message);
      if (alert.replaceKey) this.forget(alert.replaceKey);
      return false;
    }
  }

  private async sendMessage(alert: Alert): Promise<number | null> {
    const body = new URLSearchParams({
      chat_id: this.config.chatId,
      text: truncate(formatText(alert), MAX_MESSAGE_LENGTH),
    });
    const markup = copyKeyboard(alert.copyText);
    if (markup) body.set('reply_markup', markup);
    return this.post('sendMessage', body);
  }

  private async sendPhoto(alert: Alert, attachment: AlertAttachment): Promise<number | null> {
    const form = new FormData();
    form.append('chat_id', this.config.chatId);
    form.append('caption', truncate(formatText(alert), MAX_CAPTION_LENGTH));
    form.append(PHOTO_FIELD, toBlob(attachment), attachment.filename);
    const markup = copyKeyboard(alert.copyText);
    if (markup) form.append('reply_markup', markup);
    return this.post('sendPhoto', form);
  }

  private async editMedia(previous: TrackedMessage, alert: Alert, attachment: AlertAttachment): Promise<void> {
    const form = new FormData();
    form.append('chat_id', this.config.chatId);
    form.append('message_id', String(previous.messageId));
    form.append(
      'media',
      JSON.stringify({
        type: 'photo',
        media: `attach://${PHOTO_FIELD}`,
        caption: truncate(formatText(alert), MAX_CAPTION_LENGTH),
      }),
    );
    form.append(PHOTO_FIELD, toBlob(attachment), attachment.filename);
    form.append('reply_markup', editKeyboard(alert.copyText));
    await this.post('editMessageMedia', form);
  }

  /** Edits caption or text depending on what the tracked message is. */
  private async editText(
    previous: TrackedMessage,
    content: Pick<Alert, 'subject' | 'body'>,
    copyText: string | undefined,
  ): Promise<void> {
    const body = new URLSearchParams({
      chat_id: this.config.chatId,
      message_id: String(previous.messageId),
    });
    if (previous.hasMedia) {
      body.set('caption', truncate(formatText(content), MAX_CAPTION_LENGTH));
    } else {
      body.set('text', truncate(formatText(content), MAX_MESSAGE_LENGTH));
    }
    body.set('reply_markup', editKeyboard(copyText));
    await this.post(previous.hasMedia ? 'editMessageCaption' : 'editMessageText', body);
  }

  private remember(replaceKey: string | undefined, messageId: number | null, hasMedia: boolean): void {
    if (!replaceKey) return;
    if (messageId === null) {
      console.warn(`Telegram did not return a message id; "${replaceKey}" alerts will not be edited in place.`);
      return;
    }
    this.tracked = { ...this.tracked, [replaceKey]: { messageId, hasMedia } };
  }

  private forget(replaceKey: string): void {
    const { [replaceKey]: _dropped, ...rest } = this.tracked;
    this.tracked = rest;
  }

  /** Posts to the Bot API and returns the resulting message id when Telegram reports one. */
  private async post(method: string, body: BodyInit): Promise<number | null> {
    const url = `${TELEGRAM_API_BASE}/bot${this.config.botToken}/${method}`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const raw = await response.text().catch(() => '');
    if (!response.ok) {
      // Telegram returns a JSON description; surface it without leaking the token.
      throw new Error(`${method} responded ${response.status}: ${raw.slice(0, 200)}`);
    }
    return extractMessageId(raw);
  }
}
