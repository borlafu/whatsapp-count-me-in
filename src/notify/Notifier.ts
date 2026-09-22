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
  /**
   * Short text the operator will want to paste somewhere (a pairing code).
   * Channels with rich messages offer it as a one-tap copy action.
   */
  copyText?: string;
  /**
   * Alerts sharing a key describe one evolving situation (the same pairing
   * window with rotating codes). Channels that can edit an earlier delivery
   * update it in place instead of posting again; the rest simply send.
   */
  replaceKey?: string;
}

/** Final wording for a keyed alert once the situation it described is over. */
export interface AlertResolution {
  subject: string;
  body: string;
}

export interface Notifier {
  /** Delivers the alert. Implementations must never throw: alerting is best-effort. */
  send(alert: Alert): Promise<void>;
  /**
   * Rewrites the last delivery for `replaceKey` with closing text, if the
   * channel kept track of it. Optional: channels without message editing
   * (email, console) leave it out. Must never throw.
   */
  resolve?(replaceKey: string, resolution: AlertResolution): Promise<void>;
}
