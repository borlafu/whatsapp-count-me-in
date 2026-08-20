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

export class EmailNotifier implements Notifier {
  constructor(
    private config: SmtpConfig,
    private transport: MailTransport,
  ) {}

  async send(alert: Alert): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.config.from,
        to: this.config.to,
        subject: alert.subject,
        text: alert.body,
        ...(alert.attachment
          ? {
              attachments: [
                {
                  filename: alert.attachment.filename,
                  content: alert.attachment.data,
                  contentType: alert.attachment.mime,
                },
              ],
            }
          : {}),
      });
    } catch (err) {
      console.error('Email alert failed:', err instanceof Error ? err.message : err);
    }
  }
}
