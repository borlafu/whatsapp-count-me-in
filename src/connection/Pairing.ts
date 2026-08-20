import qrcode from 'qrcode';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Notifier } from '../notify/Notifier.js';

/** Baileys rotates the QR every ~20s; don't spam a channel with every rotation. */
const QR_PUSH_INTERVAL_MS = 90_000;
const QR_PNG_SCALE = 8;
const QR_PNG_MARGIN = 2;

/**
 * Delivers re-link instructions to the operator: a pairing code when a phone
 * number is configured, plus the QR code as a PNG so there is always a way in.
 *
 * The QR string itself is never logged or included in text — it is equivalent
 * to full account access.
 */
export class Pairing {
  private lastPushAt: number | null = null;
  private pairingCode: string | null = null;
  private hasRequestedCode = false;

  constructor(
    private notifier: Notifier,
    private phoneNumber: string | undefined,
    private now: () => number = Date.now,
  ) {}

  /** Starts a new pairing window: forgets the throttle as well as the code. */
  reset(): void {
    this.lastPushAt = null;
    this.beginSocketWindow();
  }

  /**
   * Called for every new socket. A pairing code is bound to the socket that
   * issued it, so it must be re-requested; the push throttle deliberately
   * survives, since sockets churn while nobody has linked the bot yet.
   */
  beginSocketWindow(): void {
    this.pairingCode = null;
    this.hasRequestedCode = false;
  }

  async handleQr(qr: string, sock: WASocket): Promise<void> {
    await this.printToTerminal(qr);
    await this.requestPairingCodeOnce(sock);

    if (!this.shouldPush()) return;
    this.lastPushAt = this.now();

    const png = await this.renderPng(qr);
    await this.notifier.send({
      subject: 'WhatsApp re-link required',
      body: this.buildBody(),
      ...(png ? { attachment: { filename: 'whatsapp-qr.png', mime: 'image/png', data: png } } : {}),
    });
  }

  private shouldPush(): boolean {
    if (this.lastPushAt === null) return true;
    return this.now() - this.lastPushAt >= QR_PUSH_INTERVAL_MS;
  }

  private buildBody(): string {
    const steps = this.pairingCode
      ? [
          `Pairing code: ${this.pairingCode}`,
          '',
          'On your phone: WhatsApp > Settings > Linked devices > Link a device >',
          '"Link with phone number instead", then enter the code above.',
          '',
          'The attached QR code is an alternative if the code has expired.',
        ]
      : [
          'On your phone: WhatsApp > Settings > Linked devices > Link a device,',
          'then scan the attached QR code.',
        ];

    return [
      'The bot needs to be linked to your WhatsApp account again.',
      '',
      ...steps,
      '',
      'Codes rotate; if this one no longer works a new alert will follow shortly.',
    ].join('\n');
  }

  private async requestPairingCodeOnce(sock: WASocket): Promise<void> {
    if (!this.phoneNumber || this.hasRequestedCode) return;
    this.hasRequestedCode = true;
    try {
      this.pairingCode = await sock.requestPairingCode(this.phoneNumber);
      console.log('Pairing code requested; delivered via alert channels.');
    } catch (err) {
      console.error('Could not request a pairing code, falling back to QR only:', err);
    }
  }

  private async renderPng(qr: string): Promise<Buffer | null> {
    try {
      return await qrcode.toBuffer(qr, { type: 'png', scale: QR_PNG_SCALE, margin: QR_PNG_MARGIN });
    } catch (err) {
      console.error('Failed to render QR code as PNG:', err);
      return null;
    }
  }

  private async printToTerminal(qr: string): Promise<void> {
    try {
      console.log('Scan this QR code with your WhatsApp app:');
      console.log(await qrcode.toString(qr, { type: 'terminal', small: true }));
    } catch (err) {
      console.error('Failed to generate QR code:', err);
    }
  }
}
