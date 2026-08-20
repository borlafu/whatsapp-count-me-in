/**
 * Out-of-band alerting used to reach the operator when the WhatsApp connection
 * needs attention (session died, bot has been offline for a while, a fresh QR
 * code or pairing code is waiting to be used).
 */

export interface AlertAttachment {
  filename: string;
  mime: string;
  data: Buffer;
}

export interface Alert {
  subject: string;
  body: string;
  attachment?: AlertAttachment;
}

export interface Notifier {
  /** Delivers the alert. Implementations must never throw: alerting is best-effort. */
  send(alert: Alert): Promise<void>;
}
