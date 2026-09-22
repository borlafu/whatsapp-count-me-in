import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WASocket } from '@whiskeysockets/baileys';
import { Pairing } from '../connection/Pairing.js';
import type { Alert, Notifier } from '../notify/Notifier.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Exercises the real `qrcode` renderer, so no fake timers here. */
describe('Pairing', () => {
  let alerts: Alert[];
  let resolved: Array<{ key: string; subject: string }>;
  let notifier: Notifier;
  let sock: WASocket;

  beforeEach(() => {
    alerts = [];
    resolved = [];
    notifier = {
      send: vi.fn(async (alert: Alert) => { alerts.push(alert); }),
      resolve: vi.fn(async (key: string, update: { subject: string }) => {
        resolved.push({ key, subject: update.subject });
      }),
    };
    sock = { requestPairingCode: vi.fn(async () => 'ABCD1234') } as unknown as WASocket;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches a real PNG rendering of the QR code', async () => {
    const pairing = new Pairing(notifier, undefined);

    await pairing.handleQr('2@abc/def+ghi==,jkl,mno', sock);

    const attachment = alerts[0]?.attachment;
    expect(attachment?.mime).toBe('image/png');
    expect(attachment?.data.subarray(0, 4)).toEqual(PNG_MAGIC);
  });

  it('includes the pairing code as the primary instruction', async () => {
    const pairing = new Pairing(notifier, '34600111222');

    await pairing.handleQr('2@abc', sock);

    expect(alerts[0]?.body).toContain('Pairing code: ABCD1234');
    expect(alerts[0]?.body).toContain('Link with phone number instead');
  });

  it('re-requests the code for a new socket but keeps the push throttle', async () => {
    let clock = 0;
    const pairing = new Pairing(notifier, '34600111222', () => clock);

    await pairing.handleQr('2@abc', sock);
    clock += 10_000;
    pairing.beginSocketWindow();
    await pairing.handleQr('2@def', sock);

    expect(sock.requestPairingCode).toHaveBeenCalledTimes(2);
    expect(alerts).toHaveLength(1);
  });

  it('resets the rate limit and pairing code for a new window', async () => {
    let clock = 0;
    const pairing = new Pairing(notifier, '34600111222', () => clock);

    await pairing.handleQr('2@abc', sock);
    clock += 10_000;
    await pairing.handleQr('2@def', sock);
    expect(alerts).toHaveLength(1);

    await pairing.reset('linked');
    await pairing.handleQr('2@ghi', sock);
    expect(alerts).toHaveLength(2);
    expect(sock.requestPairingCode).toHaveBeenCalledTimes(2);
  });

  it('offers the pairing code as copyable text', async () => {
    const pairing = new Pairing(notifier, '34600111222');

    await pairing.handleQr('2@abc', sock);

    expect(alerts[0]?.copyText).toBe('ABCD1234');
  });

  it('has nothing to copy without a pairing code', async () => {
    const pairing = new Pairing(notifier, undefined);

    await pairing.handleQr('2@abc', sock);

    expect(alerts[0]?.copyText).toBeUndefined();
  });

  it('keeps one replace key per pairing window and changes it on reset', async () => {
    let clock = 0;
    const pairing = new Pairing(notifier, undefined, () => clock);

    await pairing.handleQr('2@abc', sock);
    clock += 100_000;
    pairing.beginSocketWindow();
    await pairing.handleQr('2@def', sock);
    await pairing.reset('linked');
    await pairing.handleQr('2@ghi', sock);

    expect(alerts).toHaveLength(3);
    expect(alerts[0]!.replaceKey).toBeDefined();
    expect(alerts[1]!.replaceKey).toBe(alerts[0]!.replaceKey);
    expect(alerts[2]!.replaceKey).not.toBe(alerts[0]!.replaceKey);
  });

  it('resolves the pushed alert as linked when the window closes after a link', async () => {
    const pairing = new Pairing(notifier, '34600111222');

    await pairing.handleQr('2@abc', sock);
    await pairing.reset('linked');

    expect(resolved).toEqual([{ key: alerts[0]!.replaceKey, subject: 'WhatsApp re-link complete' }]);
  });

  it('resolves the pushed alert as superseded when credentials are reset again', async () => {
    const pairing = new Pairing(notifier, '34600111222');

    await pairing.handleQr('2@abc', sock);
    await pairing.reset('superseded');

    expect(resolved[0]?.subject).toBe('WhatsApp re-link instructions superseded');
  });

  it('does not resolve anything when nothing was pushed in the window', async () => {
    const pairing = new Pairing(notifier, '34600111222');

    await pairing.reset('linked');

    expect(resolved).toHaveLength(0);
  });

  it('drops a QR that was still rendering when the window was reset', async () => {
    const pending = Promise.withResolvers<string>();
    (sock.requestPairingCode as ReturnType<typeof vi.fn>).mockImplementationOnce(() => pending.promise);
    const pairing = new Pairing(notifier, '34600111222');

    const inFlight = pairing.handleQr('2@stale', sock);
    await vi.waitFor(() => expect(sock.requestPairingCode).toHaveBeenCalledTimes(1));
    await pairing.reset('linked');
    pending.resolve('STALE123');
    await inFlight;

    expect(alerts).toHaveLength(0);
    expect(resolved).toHaveLength(0);

    await pairing.handleQr('2@fresh', sock);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.copyText).toBe('ABCD1234');
  });

  it('works with a notifier that cannot resolve', async () => {
    const plain: Notifier = { send: vi.fn(async () => {}) };
    const pairing = new Pairing(plain, '34600111222');

    await pairing.handleQr('2@abc', sock);

    await expect(pairing.reset('linked')).resolves.toBeUndefined();
  });
});
