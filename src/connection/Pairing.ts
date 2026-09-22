import qrcode from 'qrcode';
import type { WASocket } from '@whiskeysockets/baileys';
import type { AlertResolution, Notifier } from '../notify/Notifier.js';

/** Baileys rotates the QR every ~20s; don't spam a channel with every rotation. */
const QR_PUSH_INTERVAL_MS = 90_000;
const QR_PNG_SCALE = 8;
const QR_PNG_MARGIN = 2;
const ALERT_SUBJECT = 'WhatsApp re-link required';

/** Why a pairing window ended; decides the closing text of the pushed alert. */
export type PairingOutcome = 'linked' | 'superseded';

const RESOLUTIONS: Record<PairingOutcome, AlertResolution> = {
  linked: {
    subject: 'WhatsApp re-link complete',
    body: 'The bot is linked again. The pairing code and QR code above are no longer valid.',
  },
  superseded: {
    subject: 'WhatsApp re-link instructions superseded',
    body: 'The session was reset again. Ignore the code above; fresh instructions follow in a new alert.',
  },
};

/**
 * Delivers re-link instructions to the operator: a pairing code when a phone
 * number is configured, plus the QR code as a PNG so there is always a way in.
 *
 * The QR string itself is never logged or included in text — it is equivalent
 * to full account access.
 *
 * Every push within one pairing window shares a replace key, so channels that
 * can edit (Telegram) refresh a single message instead of spamming; when the
 * window ends that message is rewritten with the outcome.
 */
export interface PairingOptions {
  /** Whether Telegram or email will carry the QR image as well. */
  hasRemoteChannels: boolean;
}

export class Pairing {
  private lastPushAt: number | null = null;
  private windowId = 0;
  private pairingCode: string | null = null;
  private hasRequestedCode = false;
  private hasCodeRequestFailed = false;

  constructor(
    private notifier: Notifier,
    private phoneNumber: string | undefined,
    private now: () => number = Date.now,
    private options: PairingOptions = { hasRemoteChannels: false },
  ) {}

  /**
   * Ends the current pairing window and starts a new one: forgets the throttle
   * as well as the code, and closes the alert pushed in the old window, if any.
   */
  async reset(outcome: PairingOutcome): Promise<void> {
    const pushedKey = this.lastPushAt === null ? null : this.replaceKey();
    this.lastPushAt = null;
    this.windowId += 1;
    this.beginSocketWindow();
    if (pushedKey === null) return;
    try {
      await this.notifier.resolve?.(pushedKey, RESOLUTIONS[outcome]);
    } catch (err) {
      console.error('Failed to close the re-link alert:', err);
    }
  }

  /**
   * Called for every new socket. A pairing code is bound to the socket that
   * issued it, so it must be re-requested; the push throttle deliberately
   * survives, since sockets churn while nobody has linked the bot yet.
   */
  beginSocketWindow(): void {
    this.pairingCode = null;
    this.hasRequestedCode = false;
    this.hasCodeRequestFailed = false;
  }

  async handleQr(qr: string, sock: WASocket): Promise<void> {
    // Events are not serialised: the connection can open (and reset the window)
    // while this handler is still awaiting. Anything from a stale window must
    // not be pushed, or an already-invalid code lands in a fresh message.
    const windowId = this.windowId;
    await this.requestPairingCodeOnce(sock, windowId);
    if (windowId !== this.windowId) return;
    if (this.shouldPrintQrToTerminal()) await this.printToTerminal(qr);

    if (!this.shouldPush()) return;
    this.lastPushAt = this.now();

    const png = await this.renderPng(qr);
    if (windowId !== this.windowId) return;
    await this.notifier.send({
      subject: ALERT_SUBJECT,
      body: this.buildBody(),
      replaceKey: this.replaceKey(),
      ...(this.pairingCode ? { copyText: this.pairingCode } : {}),
      ...(png ? { attachment: { filename: 'whatsapp-qr.png', mime: 'image/png', data: png } } : {}),
    });
  }

  /**
   * The raw QR grants full account access, so it stays out of the process log
   * whenever another way in exists: a remote channel carrying the image plus a
   * pairing code in the alert text. Otherwise it is the only credential and
   * must be printed on every rotation.
   */
  private shouldPrintQrToTerminal(): boolean {
    if (!this.options.hasRemoteChannels) return true;
    if (!this.phoneNumber) return true;
    return this.hasCodeRequestFailed;
  }

  private replaceKey(): string {
    return `pairing:${this.windowId}`;
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
      'Codes rotate; this alert is refreshed with the latest code and QR until the bot is linked.',
    ].join('\n');
  }

  private async requestPairingCodeOnce(sock: WASocket, windowId: number): Promise<void> {
    if (!this.phoneNumber || this.hasRequestedCode) return;
    this.hasRequestedCode = true;
    try {
      const code = await sock.requestPairingCode(this.phoneNumber);
      if (windowId !== this.windowId) return;
      this.pairingCode = code;
      console.log('Pairing code requested; delivered via alert channels.');
    } catch (err) {
      this.hasCodeRequestFailed = true;
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
