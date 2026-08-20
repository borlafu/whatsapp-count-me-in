import type { Alert, Notifier } from './Notifier.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 15_000;

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * Sends alerts through the Telegram Bot API using the global fetch/FormData
 * available on Node >= 24, so no extra dependency is needed.
 */
export class TelegramNotifier implements Notifier {
  constructor(
    private config: TelegramConfig,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async send(alert: Alert): Promise<void> {
    const text = `*${alert.subject}*\n\n${alert.body}`;
    try {
      if (alert.attachment) {
        await this.sendPhoto(text, alert.attachment);
        return;
      }
      await this.sendMessage(text);
    } catch (err) {
      console.error('Telegram alert failed:', err instanceof Error ? err.message : err);
    }
  }

  private async sendMessage(text: string): Promise<void> {
    const body = new URLSearchParams({
      chat_id: this.config.chatId,
      text,
      parse_mode: 'Markdown',
    });
    await this.post('sendMessage', body);
  }

  private async sendPhoto(caption: string, attachment: NonNullable<Alert['attachment']>): Promise<void> {
    const form = new FormData();
    form.append('chat_id', this.config.chatId);
    form.append('caption', caption);
    form.append('parse_mode', 'Markdown');
    // Buffer is a Uint8Array view; copy into a plain view so Blob accepts it.
    form.append(
      'photo',
      new Blob([new Uint8Array(attachment.data)], { type: attachment.mime }),
      attachment.filename,
    );
    await this.post('sendPhoto', form);
  }

  private async post(method: string, body: BodyInit): Promise<void> {
    const url = `${TELEGRAM_API_BASE}/bot${this.config.botToken}/${method}`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Telegram returns a JSON description; surface it without leaking the token.
      const detail = await response.text().catch(() => '');
      throw new Error(`${method} responded ${response.status}: ${detail.slice(0, 200)}`);
    }
  }
}
