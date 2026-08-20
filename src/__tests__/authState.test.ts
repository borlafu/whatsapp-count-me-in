import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { wipeAuthState } from '../connection/authState.js';

describe('wipeAuthState', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'auth-state-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function exists(target: string): Promise<boolean> {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  }

  it('removes the auth folder and its contents', async () => {
    const authDir = path.join(root, '.auth_info_baileys');
    await mkdir(authDir);
    await writeFile(path.join(authDir, 'creds.json'), '{}');

    await wipeAuthState('.auth_info_baileys', root);

    expect(await exists(authDir)).toBe(false);
  });

  it('succeeds when the folder is already gone', async () => {
    await expect(wipeAuthState('.auth_info_baileys', root)).resolves.toBeUndefined();
  });

  it('refuses an empty path', async () => {
    await expect(wipeAuthState('   ', root)).rejects.toThrow('empty path');
  });

  it('refuses the working directory itself', async () => {
    await expect(wipeAuthState('.', root)).rejects.toThrow('outside the working directory');
    expect(await exists(root)).toBe(true);
  });

  it('refuses a path that escapes the working directory', async () => {
    const sibling = path.join(root, 'keep.txt');
    await writeFile(sibling, 'keep me');

    await expect(wipeAuthState('../elsewhere', root)).rejects.toThrow('outside the working directory');
    expect(await exists(sibling)).toBe(true);
  });

  it('refuses an absolute path outside the working directory', async () => {
    await expect(wipeAuthState('/tmp', root)).rejects.toThrow('outside the working directory');
  });
});
