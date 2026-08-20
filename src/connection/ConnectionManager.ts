import type { AuthenticationState, BaileysEventMap, ConnectionState, WASocket } from '@whiskeysockets/baileys';
import type { Notifier } from '../notify/Notifier.js';
import { classifyDisconnect, describeDisconnect } from './classify.js';
import { Pairing } from './Pairing.js';

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
const BACKOFF_JITTER_RATIO = 0.2;
/** A replaced session sometimes comes back; give it a few spaced tries before re-pairing. */
const REPLACED_BACKOFF_MS = [30_000, 60_000, 120_000];
/** WhatsApp can ask for a restart repeatedly; stop hammering it after this many in a row. */
const MAX_IMMEDIATE_RESTARTS = 5;
/** How many unexplained stream errors in a row before the session is written off. */
const MAX_SUSPECT_ATTEMPTS = 5;
const DOWN_ALERT_AFTER_MS = 5 * 60_000;

/** Every event this class or its collaborators register on a socket. */
const TRACKED_EVENTS: Array<keyof BaileysEventMap> = [
  'creds.update',
  'contacts.upsert',
  'contacts.update',
  'connection.update',
  'messages.upsert',
];

export interface AuthStateProvider {
  load(): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }>;
  wipe(): Promise<void>;
}

export interface ConnectionManagerDeps {
  authState: AuthStateProvider;
  createSocket: (state: AuthenticationState) => Promise<WASocket> | WASocket;
  /** Registers the bot's own handlers (contacts, messages) on a fresh socket. */
  wireAppEvents: (sock: WASocket) => void;
  onOpen: (sock: WASocket) => void;
  onClose: () => void;
  notifier: Notifier;
  /** Digits only, with country code and no `+`. Enables pairing-code delivery. */
  phoneNumber?: string | undefined;
  now?: () => number;
  random?: () => number;
}

/**
 * Owns the WhatsApp connection lifecycle: reconnects transient drops with
 * exponential backoff, and recovers from a dead session on its own by wiping
 * the credentials and pushing fresh re-link instructions to the operator.
 *
 * It deliberately never calls `process.exit`: exiting would hand control to the
 * process manager, which would restart into the exact same dead session.
 */
export class ConnectionManager {
  private pairing: Pairing;
  private currentSock: WASocket | null = null;
  private isConnecting = false;
  private isStopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private transientAttempt = 0;
  private replacedAttempt = 0;
  private restartAttempt = 0;
  private suspectAttempt = 0;
  private downSince: number | null = null;
  private hasSentDownAlert = false;
  private now: () => number;
  private random: () => number;

  constructor(private deps: ConnectionManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.pairing = new Pairing(deps.notifier, deps.phoneNumber, this.now);
  }

  async start(): Promise<void> {
    this.isStopped = false;
    await this.connect();
  }

  /** Stops reconnecting and closes the live socket. */
  async stop(): Promise<void> {
    this.isStopped = true;
    this.clearTimer();
    const sock = this.currentSock;
    this.currentSock = null;
    if (sock) {
      this.deps.onClose();
      await this.teardown(sock);
    }
  }

  private async connect(): Promise<void> {
    if (this.isConnecting || this.isStopped) return;
    this.isConnecting = true;
    this.clearTimer();

    try {
      const { state, saveCreds } = await this.deps.authState.load();
      const sock = await this.deps.createSocket(state);
      // stop() may have run while the two awaits above were in flight.
      if (this.isStopped) {
        await this.teardown(sock);
        return;
      }
      this.currentSock = sock;
      // A pairing code is bound to the socket that issued it, so each new socket
      // starts a new code (the QR push throttle deliberately survives).
      this.pairing.beginSocketWindow();

      sock.ev.on('creds.update', () => {
        saveCreds().catch(err => console.error('Failed to persist credentials:', err));
      });
      this.deps.wireAppEvents(sock);
      sock.ev.on('connection.update', update => {
        void this.handleUpdate(sock, update);
      });
    } catch (err) {
      // A failure here (network, filesystem) must not become an unhandled
      // rejection: treat it like any other transient drop and retry.
      console.error('Failed to open WhatsApp connection:', err);
      this.markDown();
      await this.alertIfDownTooLong();
      this.scheduleReconnect(this.nextTransientDelay());
    } finally {
      this.isConnecting = false;
    }
  }

  private async handleUpdate(sock: WASocket, update: Partial<ConnectionState>): Promise<void> {
    // Ignore anything coming from a socket we already replaced.
    if (sock !== this.currentSock) return;

    if (update.qr) {
      await this.pairing.handleQr(update.qr, sock);
    }
    if (update.connection === 'open') {
      this.handleOpen(sock);
      return;
    }
    if (update.connection === 'close') {
      await this.handleClose(sock, update.lastDisconnect?.error);
    }
  }

  private handleOpen(sock: WASocket): void {
    const wasReportedDown = this.hasSentDownAlert;
    this.resetAttemptCounters();
    this.downSince = null;
    this.hasSentDownAlert = false;
    this.pairing.reset();

    console.log('WhatsApp Count Me In is ready!');
    this.deps.onOpen(sock);

    if (wasReportedDown) {
      void this.notify('WhatsApp bot back online', 'The connection was restored. No action needed.');
    }
  }

  private async handleClose(sock: WASocket, error: unknown): Promise<void> {
    this.currentSock = null;
    this.deps.onClose();
    await this.teardown(sock);
    if (this.isStopped) return;

    this.markDown();
    const kind = classifyDisconnect(error);
    const reason = describeDisconnect(error);
    console.log(`Connection closed [${kind}]: ${reason}`);

    if (kind === 'fatal') {
      await this.recoverSession(reason);
      return;
    }

    if (kind === 'replaced') {
      await this.handleReplaced(reason);
      return;
    }

    if (kind === 'suspect' && this.suspectAttempt >= MAX_SUSPECT_ATTEMPTS) {
      await this.recoverSession(`${reason} — repeated ${MAX_SUSPECT_ATTEMPTS} times in a row`);
      return;
    }
    if (kind === 'suspect') this.suspectAttempt += 1;

    await this.alertIfDownTooLong();

    // WhatsApp asking for a restart is normal, but it can also get stuck asking
    // forever; fall back to the regular backoff instead of spinning.
    if (kind === 'restart' && this.restartAttempt < MAX_IMMEDIATE_RESTARTS) {
      this.restartAttempt += 1;
      this.scheduleReconnect(0);
      return;
    }

    this.scheduleReconnect(this.nextTransientDelay());
  }

  /**
   * "Stream Errored (conflict)": another WhatsApp Web session took over. Retry a
   * few times with long gaps, then treat the session as gone and re-pair.
   */
  private async handleReplaced(reason: string): Promise<void> {
    const delay = REPLACED_BACKOFF_MS[this.replacedAttempt];
    if (delay === undefined) {
      await this.recoverSession(`${reason} — still replaced after ${REPLACED_BACKOFF_MS.length} retries`);
      return;
    }
    this.replacedAttempt += 1;
    console.log(`Session was replaced elsewhere; retrying in ${Math.round(delay / 1000)}s.`);
    this.scheduleReconnect(delay);
  }

  /** Wipes unusable credentials and reconnects so a fresh QR / pairing code is issued. */
  private async recoverSession(reason: string): Promise<void> {
    await this.notify(
      'WhatsApp session lost — re-link needed',
      `The session can no longer be used: ${reason}\n\n` +
        'Credentials are being reset. A pairing code and QR code will follow in a moment.',
    );

    try {
      await this.deps.authState.wipe();
    } catch (err) {
      console.error('Failed to wipe auth state:', err);
      await this.notify(
        'WhatsApp bot needs manual attention',
        'The stored credentials are unusable but could not be deleted automatically: ' +
          `${err instanceof Error ? err.message : String(err)}\n\n` +
          'Delete the auth folder on the server and restart the service.',
      );
      this.scheduleReconnect(this.nextTransientDelay());
      return;
    }

    this.resetAttemptCounters();
    this.pairing.reset();
    console.log('Credentials wiped. Starting a new pairing session.');
    this.scheduleReconnect(0);
  }

  private resetAttemptCounters(): void {
    this.transientAttempt = 0;
    this.replacedAttempt = 0;
    this.restartAttempt = 0;
    this.suspectAttempt = 0;
  }

  private markDown(): void {
    if (this.downSince === null) this.downSince = this.now();
  }

  /** Sends a single "still down" alert, so silence never means health. */
  private async alertIfDownTooLong(): Promise<void> {
    if (this.hasSentDownAlert || this.downSince === null) return;
    const downMs = this.now() - this.downSince;
    if (downMs < DOWN_ALERT_AFTER_MS) return;

    this.hasSentDownAlert = true;
    await this.notify(
      'WhatsApp bot is offline',
      `The bot has been unable to connect for ${Math.round(downMs / 60_000)} minutes and is ` +
        'still retrying. You will get another alert once it is back.',
    );
  }

  private nextTransientDelay(): number {
    const exponential = Math.min(BACKOFF_BASE_MS * 2 ** this.transientAttempt, BACKOFF_MAX_MS);
    this.transientAttempt += 1;
    const jitter = exponential * BACKOFF_JITTER_RATIO * (this.random() * 2 - 1);
    return Math.max(0, Math.round(exponential + jitter));
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.isStopped) return;
    this.clearTimer();
    console.log(`Reconnecting in ${Math.round(delayMs / 1000)}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async teardown(sock: WASocket): Promise<void> {
    for (const event of TRACKED_EVENTS) {
      try {
        sock.ev.removeAllListeners(event);
      } catch (err) {
        console.error(`Failed to remove ${event} listeners:`, err);
      }
    }
    try {
      await sock.end(undefined);
    } catch (err) {
      console.error('Failed to close the previous socket cleanly:', err);
    }
  }

  private async notify(subject: string, body: string): Promise<void> {
    try {
      await this.deps.notifier.send({ subject, body });
    } catch (err) {
      console.error('Failed to send alert:', err);
    }
  }
}
