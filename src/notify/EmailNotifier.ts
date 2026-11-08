import nodemailer from 'nodemailer';
import type { Alert, Notifier } from './Notifier.js';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  to: string;
}

/** Minimal surface of a nodemailer transport, so tests can inject a stub. */
export interface MailTransport {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  }): Promise<unknown>;
}

export function createSmtpTransport(config: SmtpConfig): MailTransport {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.pass ?? '' } } : {}),
  });
}

/**
 * Email cannot update a message, so a keyed alert (one evolving situation, such
 * as a pairing window) is mailed once, in its brief form and without media;
 * later updates for the same key are dropped.
 */
export class EmailNotifier implements Notifier {
  private sentKeys: ReadonlySet<string> = new Set();

  constructor(
    private config: SmtpConfig,
    private transport: MailTransport,
  ) {}

  async send(alert: Alert): Promise<void> {
    const { replaceKey } = alert;
    if (replaceKey !== undefined && this.sentKeys.has(replaceKey)) return;
    const attachment = replaceKey === undefined ? alert.attachment : undefined;
    try {
      await this.transport.sendMail({
        from: this.config.from,
        to: this.config.to,
        subject: alert.subject,
        text: replaceKey === undefined ? alert.body : (alert.brief ?? alert.body),
        ...(attachment
          ? {
              attachments: [
                { filename: attachment.filename, content: attachment.data, contentType: attachment.mime },
              ],
            }
          : {}),
      });
      if (replaceKey !== undefined) this.sentKeys = new Set([...this.sentKeys, replaceKey]);
    } catch (err) {
      console.error('Email alert failed:', err instanceof Error ? err.message : err);
    }
  }
}
