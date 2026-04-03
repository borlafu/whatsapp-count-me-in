import { describe, it, expect } from 'vitest';
import { CommandParser } from '../CommandParser.js';

describe('CommandParser', () => {
  it('should parse simple commands with spaces', () => {
    const result = CommandParser.parse('!join');
    expect(result.action).toBe('join');
    expect(result.args).toEqual([]);
  });

  it('should parse commands with multiple arguments', () => {
    const result = CommandParser.parse('!create "Friday Padel" 10');
    expect(result.action).toBe('create');
    expect(result.args).toEqual(['Friday Padel', '10']);
  });

  it('should handle smart quotes (macOS/iOS style)', () => {
    const result = CommandParser.parse('!create “Friday Padel” 10');
    expect(result.action).toBe('create');
    expect(result.args).toEqual(['Friday Padel', '10']);
  });

  it('should handle rename with quotes', () => {
    const result = CommandParser.parse('!rename "New Event Title"');
    expect(result.action).toBe('rename');
    expect(result.args).toEqual(['New Event Title']);
  });

  it('should handle nested single quotes (straight)', () => {
    const result = CommandParser.parse("!rename 'My Awesome Event'");
    expect(result.action).toBe('rename');
    expect(result.args).toEqual(['My Awesome Event']);
  });

  it('should handle nested single smart quotes', () => {
    const result = CommandParser.parse('!rename ‘My Awesome Event’');
    expect(result.action).toBe('rename');
    expect(result.args).toEqual(['My Awesome Event']);
  });

  it('should return undefined action for non-commands', () => {
    const result = CommandParser.parse('Hello world');
    expect(result.action).toBeUndefined();
    expect(result.args).toEqual([]);
  });

  it('should handle multiple space-separated arguments', () => {
    const result = CommandParser.parse('!resize 12');
    expect(result.action).toBe('resize');
    expect(result.args).toEqual(['12']);
  });

  it('should handle mixed quotes and spaces', () => {
    const result = CommandParser.parse('!create "Event Name" 15 "extra notes"');
    expect(result.action).toBe('create');
    expect(result.args).toEqual(['Event Name', '15', 'extra notes']);
  });

  it('should handle Spanish aliases', () => {
    const result = CommandParser.parse('!crear "Partido Viernes" 8');
    expect(result.action).toBe('create');
    expect(result.args).toEqual(['Partido Viernes', '8']);
  });

  it('should handle complex nested mixed quotes correctly', () => {
    const result = CommandParser.parse('!example “argument"with\'quotes” 123');
    expect(result.args).toEqual(['argument"with\'quotes', '123']);
  });
});
