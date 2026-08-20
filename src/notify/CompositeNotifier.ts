import type { Alert, Notifier } from './Notifier.js';

/**
 * Fans an alert out to every configured channel. A failing channel is logged
 * and never allowed to block the others or propagate: losing an alert must not
 * take the bot down.
 */
export class CompositeNotifier implements Notifier {
  constructor(private channels: Notifier[]) {}

  async send(alert: Alert): Promise<void> {
    const results = await Promise.allSettled(this.channels.map(channel => channel.send(alert)));
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Alert channel failed:', result.reason);
      }
    }
  }
}
