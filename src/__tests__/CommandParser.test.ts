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
    const tokens = CommandParser.tokenize('!example “argument"with\'quotes” 123');
    expect(tokens).toEqual(['!example', 'argument"with\'quotes', '123']);
  });

  describe('trigger forms', () => {
    const botJids = ['bot@s.whatsapp.net'];

    it('allows a space between the ! and the command', () => {
      const result = CommandParser.parse('! join');
      expect(result.action).toBe('join');
      expect(result.args).toEqual([]);
    });

    it('allows several spaces after the !', () => {
      expect(CommandParser.parse('!   salir 3').action).toBe('leave');
      expect(CommandParser.parse('!   salir 3').args).toEqual(['3']);
    });

    it('accepts a command with no ! when the bot is mentioned first', () => {
      const result = CommandParser.parse('@1234 leave 3', { botJids, mentionedJids: botJids });
      expect(result.action).toBe('leave');
      expect(result.args).toEqual(['3']);
    });

    it('strips the isolate markers WhatsApp wraps a mention in', () => {
      const result = CommandParser.parse('⁨@Count Me In⁩ status', { botJids, mentionedJids: botJids });
      expect(result.action).toBe('status');
    });

    it('still accepts the ! after a mention of the bot', () => {
      const result = CommandParser.parse('@1234 !join', { botJids, mentionedJids: botJids });
      expect(result.action).toBe('join');
    });

    it('accepts a command with no ! when replying to the bot', () => {
      const result = CommandParser.parse('leave 3', { botJids, quotedAuthor: 'bot@s.whatsapp.net' });
      expect(result.action).toBe('leave');
      expect(result.args).toEqual(['3']);
    });

    it('keeps a mention as an argument when replying to the bot', () => {
      const result = CommandParser.parse('invite @5678', {
        botJids,
        mentionedJids: ['member@s.whatsapp.net'],
        quotedAuthor: 'bot@s.whatsapp.net',
      });
      expect(result.action).toBe('invite');
      expect(result.args).toEqual(['@5678']);
    });

    it('strips only the bot mention, never another member in front of it', () => {
      const result = CommandParser.parse('@1234 invite @5678', {
        botJids,
        mentionedJids: ['bot@s.whatsapp.net', 'member@s.whatsapp.net'],
      });
      expect(result.action).toBe('invite');
      expect(result.args).toEqual(['@5678']);
    });

    it('ignores a bare command when nothing addresses the bot', () => {
      expect(CommandParser.parse('leave 3', { botJids }).action).toBeUndefined();
    });

    it('ignores a bare command when the reply quotes someone else', () => {
      const result = CommandParser.parse('leave 3', { botJids, quotedAuthor: 'someone@s.whatsapp.net' });
      expect(result.action).toBeUndefined();
    });

    it('ignores a mention of someone else that is not the bot', () => {
      const result = CommandParser.parse('@5678 leave', { botJids, mentionedJids: ['member@s.whatsapp.net'] });
      expect(result.action).toBeUndefined();
    });
  });

  describe('unknown commands', () => {
    it('suggests the closest command for a typo', () => {
      const result = CommandParser.parse('!salirr');
      expect(result.action).toBeUndefined();
      expect(result.unknown).toEqual({ typed: '!salirr', suggestion: '!salir' });
    });

    it('suggests nothing for punctuation', () => {
      expect(CommandParser.parse('!!!').unknown).toBeUndefined();
      expect(CommandParser.parse('!').unknown).toBeUndefined();
      expect(CommandParser.parse('!1').unknown).toBeUndefined();
    });

    it('suggests nothing for a word nowhere near a command', () => {
      expect(CommandParser.parse('!bicicleta').unknown).toBeUndefined();
    });

    it('holds short words to a single edit, so chat is not corrected', () => {
      expect(CommandParser.parse('!ok').unknown).toBeUndefined();
    });

    it('does not search for a suggestion for a wall of text', () => {
      expect(CommandParser.parse(`!${'a'.repeat(5000)}`).unknown).toBeUndefined();
    });

    it('does not correct a bare word in a reply to the bot', () => {
      const result = CommandParser.parse('salirr', { botJids: ['bot@s.whatsapp.net'], quotedAuthor: 'bot@s.whatsapp.net' });
      expect(result.unknown).toBeUndefined();
    });
  });
});
