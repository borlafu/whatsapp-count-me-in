import type { Alert, AlertResolution, Notifier } from './Notifier.js';

/**
 * Always-on channel: every alert also lands in the process log, so an operator
 * tailing it sees what was sent to the phone (including the pairing code).
 * Attachments are never printed; the QR image has its own terminal rendering
 * in `Pairing`, gated on whether another way in exists.
 */
export class ConsoleNotifier implements Notifier {
  async send(alert: Alert): Promise<void> {
    console.log(`[alert] ${alert.subject}\n${alert.body}`);
  }

  async resolve(_replaceKey: string, resolution: AlertResolution): Promise<void> {
    console.log(`[alert] ${resolution.subject}\n${resolution.body}`);
  }
}
