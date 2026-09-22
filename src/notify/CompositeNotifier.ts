import type { Alert, AlertResolution, Notifier } from './Notifier.js';

/**
 * Fans an alert out to every configured channel. A failing channel is logged
 * and never allowed to block the others or propagate: losing an alert must not
 * take the bot down.
 */
export class CompositeNotifier implements Notifier {
  constructor(private channels: Notifier[]) {}

  async send(alert: Alert): Promise<void> {
    await this.fanOut(this.channels.map(channel => channel.send(alert)));
  }

  async resolve(replaceKey: string, resolution: AlertResolution): Promise<void> {
    await this.fanOut(
      this.channels
        .filter(channel => typeof channel.resolve === 'function')
        .map(channel => channel.resolve!(replaceKey, resolution)),
    );
  }

  private async fanOut(deliveries: Promise<void>[]): Promise<void> {
    const results = await Promise.allSettled(deliveries);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Alert channel failed:', result.reason);
      }
    }
  }
}
