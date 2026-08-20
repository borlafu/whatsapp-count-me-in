import type { Alert, Notifier } from './Notifier.js';

/**
 * Fallback notifier used when no channel is configured (local development).
 * Keeps the alerting code path identical everywhere instead of sprinkling
 * `if (notifier)` checks through the connection logic.
 */
export class ConsoleNotifier implements Notifier {
  async send(alert: Alert): Promise<void> {
    console.log(`[alert] ${alert.subject}\n${alert.body}`);
    if (alert.attachment) {
      console.log(`[alert] attachment omitted from console output: ${alert.attachment.filename}`);
    }
  }
}
