import { rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * Deletes the Baileys auth folder so the next connection starts a fresh pairing.
 *
 * Guarded on purpose: this is an unrecoverable delete driven by remote input
 * (a disconnect status code), so the target must be a relative-resolving path
 * inside the working directory and never the working directory itself.
 */
export async function wipeAuthState(dir: string, cwd: string = process.cwd()): Promise<void> {
  const trimmed = dir.trim();
  if (!trimmed) {
    throw new Error('Refusing to wipe auth state: empty path.');
  }

  const root = path.resolve(cwd);
  const target = path.resolve(root, trimmed);
  if (target === root || !target.startsWith(root + path.sep)) {
    throw new Error(`Refusing to wipe auth state outside the working directory: ${target}`);
  }

  await rm(target, { recursive: true, force: true });
}
