import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WASocket } from '@whiskeysockets/baileys';
import { Pairing } from '../connection/Pairing.js';
import type { Alert, Notifier } from '../notify/Notifier.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Exercises the real `qrcode` renderer, so no fake timers here. */
describe('Pairing', () => {
  let alerts: Alert[];
  let notifier: Notifier;
  let sock: WASocket;

  beforeEach(() => {
    alerts = [];
    notifier = { send: vi.fn(async (alert: Alert) => { alerts.push(alert); }) };
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

  it('resets the rate limit and pairing code for a new window', async () => {
    let clock = 0;
    const pairing = new Pairing(notifier, '34600111222', () => clock);

    await pairing.handleQr('2@abc', sock);
    clock += 10_000;
    await pairing.handleQr('2@def', sock);
    expect(alerts).toHaveLength(1);

    pairing.reset();
    await pairing.handleQr('2@ghi', sock);
    expect(alerts).toHaveLength(2);
    expect(sock.requestPairingCode).toHaveBeenCalledTimes(2);
  });
});
