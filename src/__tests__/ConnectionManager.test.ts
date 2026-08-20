import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DisconnectReason, type AuthenticationState, type WASocket } from '@whiskeysockets/baileys';
import { ConnectionManager } from '../connection/ConnectionManager.js';
import type { Alert, Notifier } from '../notify/Notifier.js';

// Real QR rendering does async zlib work that does not settle under fake timers;
// it is covered for real in Pairing.test.ts.
vi.mock('qrcode', () => ({
  default: {
    toBuffer: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    toString: async () => 'terminal-qr',
  },
}));

function wsError(statusCode: number, message = 'Stream Errored'): Error {
  const err = new Error(message) as Error & { output: { statusCode: number } };
  err.output = { statusCode };
  return err;
}

class FakeEventEmitter {
  private listeners = new Map<string, Array<(arg: unknown) => void>>();
  removeAllListeners = vi.fn((event: string) => {
    this.listeners.delete(event);
  });

  on(event: string, listener: (arg: unknown) => void): void {
    const existing = this.listeners.get(event) ?? [];
    this.listeners.set(event, [...existing, listener]);
  }

  emit(event: string, arg: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(arg);
  }

  count(event: string): number {
    return (this.listeners.get(event) ?? []).length;
  }
}

class FakeSocket {
  ev = new FakeEventEmitter();
  end = vi.fn(async () => {});
  requestPairingCode = vi.fn(async () => 'ABCD1234');
  sendMessage = vi.fn(async () => ({}));

  asWASocket(): WASocket {
    return this as unknown as WASocket;
  }
}

/** Lets tests advance the manager's clock and the timer queue together. */
function createHarness(options: { createSocket?: () => FakeSocket; phoneNumber?: string } = {}) {
  const sockets: FakeSocket[] = [];
  const alerts: Alert[] = [];
  let clock = 1_000_000;

  const notifier: Notifier = { send: vi.fn(async (alert: Alert) => { alerts.push(alert); }) };
  const wipe = vi.fn(async () => {});
  const saveCreds = vi.fn(async () => {});
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const wireAppEvents = vi.fn((sock: WASocket) => {
    sock.ev.on('messages.upsert', () => {});
  });

  const manager = new ConnectionManager({
    authState: {
      load: async () => ({ state: {} as AuthenticationState, saveCreds }),
      wipe,
    },
    createSocket: () => {
      const sock = options.createSocket ? options.createSocket() : new FakeSocket();
      sockets.push(sock);
      return sock.asWASocket();
    },
    wireAppEvents,
    onOpen,
    onClose,
    notifier,
    phoneNumber: options.phoneNumber,
    // Fixed "random" removes jitter, so backoff delays are exact.
    random: () => 0.5,
    now: () => clock,
  });

  async function advance(ms: number) {
    clock += ms;
    await vi.advanceTimersByTimeAsync(ms);
  }

  async function flush() {
    await vi.advanceTimersByTimeAsync(0);
  }

  async function close(sock: FakeSocket, error: Error | undefined) {
    sock.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error, date: new Date() } });
    await flush();
  }

  async function open(sock: FakeSocket) {
    sock.ev.emit('connection.update', { connection: 'open' });
    await flush();
  }

  return { manager, sockets, alerts, notifier, wipe, onOpen, onClose, wireAppEvents, advance, flush, close, open };
}

describe('ConnectionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('startup', () => {
    it('creates a socket and wires the app handlers', async () => {
      const h = createHarness();

      await h.manager.start();

      expect(h.sockets).toHaveLength(1);
      expect(h.wireAppEvents).toHaveBeenCalledTimes(1);
      expect(h.sockets[0]!.ev.count('connection.update')).toBe(1);
      expect(h.sockets[0]!.ev.count('creds.update')).toBe(1);
    });

    it('retries instead of throwing when the socket cannot be created', async () => {
      const sockets: FakeSocket[] = [];
      let attempt = 0;
      const h = createHarness({
        createSocket: () => {
          attempt += 1;
          if (attempt === 1) throw new Error('getaddrinfo ENOTFOUND');
          const sock = new FakeSocket();
          sockets.push(sock);
          return sock;
        },
      });

      await expect(h.manager.start()).resolves.toBeUndefined();
      expect(h.sockets).toHaveLength(0);

      await h.advance(1000);
      expect(h.sockets).toHaveLength(1);
    });
  });

  describe('transient disconnects', () => {
    it('reconnects with exponential backoff capped at 60s', async () => {
      const h = createHarness();
      await h.manager.start();

      const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000];
      for (const [index, delay] of expectedDelays.entries()) {
        const sock = h.sockets[index]!;
        await h.close(sock, wsError(DisconnectReason.connectionLost));

        // Nothing must reconnect before the backoff elapses.
        await h.advance(delay - 1);
        expect(h.sockets).toHaveLength(index + 1);

        await h.advance(1);
        expect(h.sockets).toHaveLength(index + 2);
      }
    });

    it('resets the backoff once the connection opens', async () => {
      const h = createHarness();
      await h.manager.start();

      await h.close(h.sockets[0]!, wsError(DisconnectReason.connectionLost));
      await h.advance(1_000);
      await h.open(h.sockets[1]!);

      await h.close(h.sockets[1]!, wsError(DisconnectReason.connectionLost));
      await h.advance(1_000);
      expect(h.sockets).toHaveLength(3);
    });

    it('never wipes credentials for a transient drop', async () => {
      const h = createHarness();
      await h.manager.start();

      await h.close(h.sockets[0]!, wsError(DisconnectReason.connectionLost));
      await h.advance(60_000);

      expect(h.wipe).not.toHaveBeenCalled();
    });
  });

  describe('restartRequired', () => {
    it('reconnects immediately without consuming a backoff step', async () => {
      const h = createHarness();
      await h.manager.start();

      await h.close(h.sockets[0]!, wsError(DisconnectReason.restartRequired));
      await h.advance(0);
      expect(h.sockets).toHaveLength(2);

      // The next transient drop still starts from the base delay.
      await h.close(h.sockets[1]!, wsError(DisconnectReason.connectionLost));
      await h.advance(1_000);
      expect(h.sockets).toHaveLength(3);
    });

    it('falls back to backoff after five immediate restarts in a row', async () => {
      const h = createHarness();
      await h.manager.start();

      for (let i = 0; i < 5; i++) {
        await h.close(h.sockets[i]!, wsError(DisconnectReason.restartRequired));
        await h.advance(0);
        expect(h.sockets).toHaveLength(i + 2);
      }

      // Sixth in a row: stop hammering the server.
      await h.close(h.sockets[5]!, wsError(DisconnectReason.restartRequired));
      await h.advance(0);
      expect(h.sockets).toHaveLength(6);
      await h.advance(1_000);
      expect(h.sockets).toHaveLength(7);
    });

    it('resets the restart allowance once the connection opens', async () => {
      const h = createHarness();
      await h.manager.start();

      for (let i = 0; i < 5; i++) {
        await h.close(h.sockets[i]!, wsError(DisconnectReason.restartRequired));
        await h.advance(0);
      }
      await h.open(h.sockets[5]!);

      await h.close(h.sockets[5]!, wsError(DisconnectReason.restartRequired));
      await h.advance(0);
      expect(h.sockets).toHaveLength(7);
    });
  });

  describe('unexplained stream errors (badSession)', () => {
    it('retries with backoff instead of wiping on the first occurrence', async () => {
      const h = createHarness();
      await h.manager.start();

      await h.close(h.sockets[0]!, wsError(DisconnectReason.badSession));
      expect(h.wipe).not.toHaveBeenCalled();

      await h.advance(1_000);
      expect(h.sockets).toHaveLength(2);
    });

    it('re-pairs after five in a row', async () => {
      const h = createHarness();
      await h.manager.start();

      const delays = [1_000, 2_000, 4_000, 8_000, 16_000];
      for (const [index, delay] of delays.entries()) {
        await h.close(h.sockets[index]!, wsError(DisconnectReason.badSession));
        expect(h.wipe).not.toHaveBeenCalled();
        await h.advance(delay);
      }

      await h.close(h.sockets[5]!, wsError(DisconnectReason.badSession));
      expect(h.wipe).toHaveBeenCalledTimes(1);
    });

    it('forgets the streak once the connection opens', async () => {
      const h = createHarness();
      await h.manager.start();

      const delays = [1_000, 2_000, 4_000, 8_000, 16_000];
      for (const [index, delay] of delays.entries()) {
        await h.close(h.sockets[index]!, wsError(DisconnectReason.badSession));
        await h.advance(delay);
      }
      await h.open(h.sockets[5]!);

      await h.close(h.sockets[5]!, wsError(DisconnectReason.badSession));
      expect(h.wipe).not.toHaveBeenCalled();
    });
  });

  describe('fatal disconnects', () => {
    it('wipes the auth state, alerts, and re-pairs without exiting', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const h = createHarness();
      await h.manager.start();

      await h.close(h.sockets[0]!, wsError(DisconnectReason.loggedOut, 'Logged out'));

      expect(h.wipe).toHaveBeenCalledTimes(1);
      expect(h.alerts[0]?.subject).toBe('WhatsApp session lost — re-link needed');
      expect(exitSpy).not.toHaveBeenCalled();

      await h.advance(0);
      expect(h.sockets).toHaveLength(2);
    });

    it('asks for manual help when the wipe itself fails', async () => {
      const h = createHarness();
      h.wipe.mockRejectedValueOnce(new Error('EACCES'));
      await h.manager.start();

      await h.close(h.sockets[0]!, wsError(DisconnectReason.loggedOut));

      expect(h.alerts.map(a => a.subject)).toContain('WhatsApp bot needs manual attention');
    });
  });

  describe('connectionReplaced (conflict)', () => {
    it('retries three times with long gaps, then re-pairs', async () => {
      const h = createHarness();
      await h.manager.start();

      const gaps = [30_000, 60_000, 120_000];
      for (const [index, gap] of gaps.entries()) {
        await h.close(h.sockets[index]!, wsError(DisconnectReason.connectionReplaced, 'Stream Errored (conflict)'));
        expect(h.wipe).not.toHaveBeenCalled();
        await h.advance(gap);
        expect(h.sockets).toHaveLength(index + 2);
      }

      // Fourth conflict in a row: the session is gone for good.
      await h.close(h.sockets[3]!, wsError(DisconnectReason.connectionReplaced, 'Stream Errored (conflict)'));
      expect(h.wipe).toHaveBeenCalledTimes(1);
    });

    it('does not loop forever on the 3s timer the old code used', async () => {
      const h = createHarness();
      await h.manager.start();

      await h.close(h.sockets[0]!, wsError(DisconnectReason.connectionReplaced));
      await h.advance(3_000);

      expect(h.sockets).toHaveLength(1);
    });
  });

  describe('socket hygiene', () => {
    it('closes and unsubscribes the old socket on every disconnect', async () => {
      const h = createHarness();
      await h.manager.start();
      const first = h.sockets[0]!;

      await h.close(first, wsError(DisconnectReason.connectionLost));

      expect(first.end).toHaveBeenCalledWith(undefined);
      expect(first.ev.removeAllListeners).toHaveBeenCalledWith('connection.update');
      expect(first.ev.removeAllListeners).toHaveBeenCalledWith('messages.upsert');
      expect(first.ev.count('connection.update')).toBe(0);
    });

    it('ignores late events from a socket that was already replaced', async () => {
      const h = createHarness();
      await h.manager.start();
      const first = h.sockets[0]!;

      await h.close(first, wsError(DisconnectReason.connectionLost));
      await h.advance(1_000);
      expect(h.sockets).toHaveLength(2);

      // Re-emit on the stale socket: it must not schedule another reconnect.
      first.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: wsError(408) } });
      await h.advance(60_000);
      expect(h.sockets).toHaveLength(2);
    });

    it('stops reconnecting after stop()', async () => {
      const h = createHarness();
      await h.manager.start();

      await h.close(h.sockets[0]!, wsError(DisconnectReason.connectionLost));
      await h.manager.stop();
      await h.advance(60_000);

      expect(h.sockets).toHaveLength(1);
    });
  });

  describe('scheduler lifecycle', () => {
    it('starts on open and stops on close', async () => {
      const h = createHarness();
      await h.manager.start();

      await h.open(h.sockets[0]!);
      expect(h.onOpen).toHaveBeenCalledTimes(1);

      await h.close(h.sockets[0]!, wsError(DisconnectReason.connectionLost));
      expect(h.onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('downtime alerts', () => {
    it('alerts once after five minutes offline, then again when back online', async () => {
      const h = createHarness();
      await h.manager.start();

      // Keep failing for well over the alert threshold.
      for (let i = 0; i < 12; i++) {
        await h.close(h.sockets[i]!, wsError(DisconnectReason.connectionLost));
        await h.advance(60_000);
      }

      const offlineAlerts = h.alerts.filter(a => a.subject === 'WhatsApp bot is offline');
      expect(offlineAlerts).toHaveLength(1);

      await h.open(h.sockets[h.sockets.length - 1]!);
      expect(h.alerts.map(a => a.subject)).toContain('WhatsApp bot back online');
    });

    it('stays quiet for a short blip', async () => {
      const h = createHarness();
      await h.manager.start();

      await h.close(h.sockets[0]!, wsError(DisconnectReason.connectionLost));
      await h.advance(1_000);
      await h.open(h.sockets[1]!);

      expect(h.alerts).toHaveLength(0);
    });
  });

  describe('re-link delivery', () => {
    async function emitQr(h: ReturnType<typeof createHarness>, sock: FakeSocket, qr: string) {
      sock.ev.emit('connection.update', { qr });
      // The QR handler renders a PNG, so let its promises settle.
      await vi.advanceTimersByTimeAsync(0);
      await h.flush();
    }

    it('sends the QR image and a pairing code when a phone number is configured', async () => {
      const h = createHarness({ phoneNumber: '34600111222' });
      await h.manager.start();
      const sock = h.sockets[0]!;

      await emitQr(h, sock, 'qr-payload-1');

      const alert = h.alerts.find(a => a.subject === 'WhatsApp re-link required');
      expect(alert).toBeDefined();
      expect(alert!.attachment?.filename).toBe('whatsapp-qr.png');
      expect(alert!.attachment?.data.length).toBeGreaterThan(0);
      expect(alert!.body).toContain('ABCD1234');
      // The QR payload is account-level access: it must never appear as text.
      expect(alert!.body).not.toContain('qr-payload-1');
      expect(sock.requestPairingCode).toHaveBeenCalledWith('34600111222');
    });

    it('falls back to QR-only instructions without a phone number', async () => {
      const h = createHarness();
      await h.manager.start();
      const sock = h.sockets[0]!;

      await emitQr(h, sock, 'qr-payload-1');

      const alert = h.alerts.find(a => a.subject === 'WhatsApp re-link required');
      expect(alert!.body).toContain('scan the attached QR code');
      expect(sock.requestPairingCode).not.toHaveBeenCalled();
    });

    it('still sends instructions when the pairing code request fails', async () => {
      const h = createHarness({ phoneNumber: '34600111222' });
      await h.manager.start();
      const sock = h.sockets[0]!;
      sock.requestPairingCode.mockRejectedValueOnce(new Error('not-authorized'));

      await emitQr(h, sock, 'qr-payload-1');

      const alert = h.alerts.find(a => a.subject === 'WhatsApp re-link required');
      expect(alert?.attachment?.data.length).toBeGreaterThan(0);
    });

    it('rate-limits rotating QR codes to one push every 90s', async () => {
      const h = createHarness();
      await h.manager.start();
      const sock = h.sockets[0]!;

      await emitQr(h, sock, 'qr-1');
      await h.advance(20_000);
      await emitQr(h, sock, 'qr-2');
      expect(h.alerts).toHaveLength(1);

      await h.advance(70_000);
      await emitQr(h, sock, 'qr-3');
      expect(h.alerts).toHaveLength(2);
    });

    it('requests the pairing code only once per pairing window', async () => {
      const h = createHarness({ phoneNumber: '34600111222' });
      await h.manager.start();
      const sock = h.sockets[0]!;

      await emitQr(h, sock, 'qr-1');
      await h.advance(90_000);
      await emitQr(h, sock, 'qr-2');

      expect(sock.requestPairingCode).toHaveBeenCalledTimes(1);
    });

    it('requests a fresh pairing code for every new socket', async () => {
      // A code is bound to the socket that issued it, so a reconnect while
      // still unlinked must not keep advertising the previous one.
      const h = createHarness({ phoneNumber: '34600111222' });
      await h.manager.start();

      await emitQr(h, h.sockets[0]!, 'qr-1');
      await h.close(h.sockets[0]!, wsError(DisconnectReason.timedOut, 'QR refs attempts ended'));
      await h.advance(1_000);

      const next = h.sockets[1]!;
      await emitQr(h, next, 'qr-2');
      expect(next.requestPairingCode).toHaveBeenCalledTimes(1);
    });

    it('starts a new pairing window after the connection opens', async () => {
      const h = createHarness({ phoneNumber: '34600111222' });
      await h.manager.start();
      const sock = h.sockets[0]!;

      await emitQr(h, sock, 'qr-1');
      await h.open(sock);
      await h.close(sock, wsError(DisconnectReason.loggedOut));
      await h.advance(0);

      const next = h.sockets[1]!;
      await emitQr(h, next, 'qr-2');
      expect(next.requestPairingCode).toHaveBeenCalledTimes(1);
    });
  });
});
