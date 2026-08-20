import { DisconnectReason } from '@whiskeysockets/baileys';

/**
 * How a closed connection should be handled.
 *
 * - `restart`  Baileys asks for an immediate reconnect (normal right after pairing).
 * - `transient` Network-level blip: retry with exponential backoff, forever.
 * - `replaced`  Another WhatsApp Web session took over ("Stream Errored (conflict)").
 *               Worth a few spaced retries, then the session must be considered gone.
 * - `suspect`   Possibly a broken session, possibly not: retry, and only give up
 *               after it keeps happening.
 * - `fatal`     Credentials are unusable: the auth state has to be wiped and re-paired.
 */
export type DisconnectClass = 'restart' | 'transient' | 'replaced' | 'suspect' | 'fatal';

const FATAL_CODES: ReadonlySet<number> = new Set([
  DisconnectReason.loggedOut, // 401
  DisconnectReason.forbidden, // 403
  DisconnectReason.multideviceMismatch, // 411
]);

const TRANSIENT_CODES: ReadonlySet<number> = new Set([
  DisconnectReason.connectionLost, // 408 (same value as timedOut)
  DisconnectReason.connectionClosed, // 428
  DisconnectReason.unavailableService, // 503
]);

/** Reads the Boom status code Baileys attaches to disconnect errors. */
export function getStatusCode(error: unknown): number | undefined {
  const output = (error as { output?: { statusCode?: unknown } } | undefined)?.output;
  return typeof output?.statusCode === 'number' ? output.statusCode : undefined;
}

/**
 * Classifies a disconnect. Anything unrecognised — including a plain network
 * error with no status code — is treated as transient, because retrying is
 * always safer than wiping a working session.
 */
export function classifyDisconnect(error: unknown): DisconnectClass {
  const statusCode = getStatusCode(error);
  if (statusCode === undefined) return 'transient';
  if (statusCode === DisconnectReason.restartRequired) return 'restart';
  if (statusCode === DisconnectReason.connectionReplaced) return 'replaced';
  if (FATAL_CODES.has(statusCode)) return 'fatal';
  // 500 is also Baileys' fallback for any <stream:error> it cannot classify
  // (getErrorCodeFromStreamError), so it is not proof of a broken session.
  if (statusCode === DisconnectReason.badSession) return 'suspect';
  if (TRANSIENT_CODES.has(statusCode)) return 'transient';
  return 'transient';
}

export function describeDisconnect(error: unknown): string {
  const statusCode = getStatusCode(error);
  const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
  return statusCode === undefined ? message : `${message} (status ${statusCode})`;
}
