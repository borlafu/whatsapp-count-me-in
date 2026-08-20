import { describe, it, expect } from 'vitest';
import { DisconnectReason } from '@whiskeysockets/baileys';
import { classifyDisconnect, describeDisconnect, getStatusCode } from '../connection/classify.js';

function wsError(statusCode: number, message = 'Stream Errored'): Error {
  const err = new Error(message) as Error & { output: { statusCode: number } };
  err.output = { statusCode };
  return err;
}

describe('classifyDisconnect', () => {
  it('classifies restartRequired as restart', () => {
    expect(classifyDisconnect(wsError(DisconnectReason.restartRequired))).toBe('restart');
  });

  it('classifies connectionReplaced (conflict) as replaced', () => {
    expect(classifyDisconnect(wsError(DisconnectReason.connectionReplaced, 'Stream Errored (conflict)')))
      .toBe('replaced');
  });

  it.each([
    ['loggedOut', DisconnectReason.loggedOut],
    ['forbidden', DisconnectReason.forbidden],
    ['multideviceMismatch', DisconnectReason.multideviceMismatch],
  ])('classifies %s as fatal', (_name, code) => {
    expect(classifyDisconnect(wsError(code))).toBe('fatal');
  });

  it('classifies badSession as suspect, not fatal', () => {
    // Baileys also uses 500 as its fallback for any stream error it cannot
    // classify, so it must not wipe credentials on the first occurrence.
    expect(classifyDisconnect(wsError(DisconnectReason.badSession))).toBe('suspect');
  });

  it.each([
    ['connectionLost', DisconnectReason.connectionLost],
    ['connectionClosed', DisconnectReason.connectionClosed],
    ['unavailableService', DisconnectReason.unavailableService],
  ])('classifies %s as transient', (_name, code) => {
    expect(classifyDisconnect(wsError(code))).toBe('transient');
  });

  it('treats a plain network error with no status code as transient', () => {
    expect(classifyDisconnect(new Error('socket hang up'))).toBe('transient');
  });

  it('treats an unknown status code as transient rather than fatal', () => {
    expect(classifyDisconnect(wsError(418))).toBe('transient');
  });

  it('treats a missing error as transient', () => {
    expect(classifyDisconnect(undefined)).toBe('transient');
  });
});

describe('getStatusCode', () => {
  it('reads the Boom status code', () => {
    expect(getStatusCode(wsError(401))).toBe(401);
  });

  it('returns undefined when there is no Boom output', () => {
    expect(getStatusCode(new Error('nope'))).toBeUndefined();
    expect(getStatusCode(undefined)).toBeUndefined();
  });
});

describe('describeDisconnect', () => {
  it('includes the status code when present', () => {
    expect(describeDisconnect(wsError(440, 'Stream Errored (conflict)')))
      .toBe('Stream Errored (conflict) (status 440)');
  });

  it('falls back to the message alone', () => {
    expect(describeDisconnect(new Error('socket hang up'))).toBe('socket hang up');
  });

  it('handles a missing error', () => {
    expect(describeDisconnect(undefined)).toBe('unknown error');
  });
});
