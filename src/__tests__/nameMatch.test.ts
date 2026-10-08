import { describe, it, expect } from 'vitest';
import { findByName } from '../nameMatch.js';

const people = (...names: string[]) => names.map(user_name => ({ user_name }));

describe('findByName', () => {
  it('matches a full name exactly', () => {
    const items = people('Juanlu', 'Marta');

    const found = findByName(items, 'Juanlu');

    expect(found).toEqual([{ user_name: 'Juanlu' }]);
  });

  it('ignores case and surrounding whitespace', () => {
    const found = findByName(people('Juanlu'), '  JUANLU ');

    expect(found).toEqual([{ user_name: 'Juanlu' }]);
  });

  it('ignores accents in either direction', () => {
    expect(findByName(people('Juanlú'), 'Juanlu')).toHaveLength(1);
    expect(findByName(people('Juanlu'), 'Juanlú')).toHaveLength(1);
  });

  it('matches the first word of a full name', () => {
    const found = findByName(people('Juan Carlos'), 'Juan');

    expect(found).toEqual([{ user_name: 'Juan Carlos' }]);
  });

  it('matches a later word of a full name', () => {
    const found = findByName(people('Juan Carlos'), 'Carlos');

    expect(found).toEqual([{ user_name: 'Juan Carlos' }]);
  });

  it('does not match the middle of a word', () => {
    expect(findByName(people('Juan'), 'an')).toEqual([]);
  });

  it('returns every partial match so the caller can refuse to guess', () => {
    const found = findByName(people('Juanlu', 'Juan Carlos', 'Marta'), 'Juan');

    expect(found).toHaveLength(2);
  });

  it('prefers an exact name over anyone it is a prefix of', () => {
    const found = findByName(people('Juan', 'Juanlu'), 'Juan');

    expect(found).toEqual([{ user_name: 'Juan' }]);
  });

  it('returns nothing for an empty query', () => {
    expect(findByName(people('Juanlu'), '   ')).toEqual([]);
  });

  it('returns nothing when no one matches', () => {
    expect(findByName(people('Juanlu'), 'Marta')).toEqual([]);
  });
});
