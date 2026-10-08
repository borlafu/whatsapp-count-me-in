import { resolveCommand, suggestCommand } from './commandAliases.js';

export interface ParseContext {
  /** Every JID the bot itself answers to, already normalized. */
  botJids?: readonly string[];
  /** JIDs mentioned in the message, in the order they appear in the text. */
  mentionedJids?: readonly string[];
  /** Author of the quoted message, when this message is a reply. */
  quotedAuthor?: string | undefined;
}

export interface ParsedCommand {
  action: string | undefined;
  args: string[];
  /** A "!word" that is no command, with the closest real one to it. */
  unknown?: { typed: string; suggestion: string };
}

/**
 * Letters only, so "!", "!!!" and "!1" stay silent, and no longer than a
 * command could plausibly be mistyped as — the longest is "!recordatorios" at
 * 14. The cap keeps a hostile wall of text out of the suggestion search.
 */
const COMMAND_WORD = /^![\p{L}]{2,20}$/u;

/**
 * A leading @mention: either wrapped in the ⁨…⁩ isolate markers WhatsApp adds,
 * where the display name may contain spaces ("⁨@Count Me In⁩"), or a bare
 * single token ("@34600111222").
 */
const LEADING_MENTION = /^(?:⁨@[^⁩]*⁩|@\S+)\s*/;

const noCommand = (): ParsedCommand => ({ action: undefined, args: [] });

export class CommandParser {
  /**
   * Parses a message body into a canonical action and an array of arguments.
   * Supports quoted strings (straight and smart quotes).
   *
   * A command is recognised in three forms: the plain "!join", an @mention of
   * the bot, or a reply to one of the bot's own messages. The last two address
   * the bot explicitly, so the "!" becomes optional there.
   */
  static parse(body: string, ctx: ParseContext = {}): ParsedCommand {
    const mentionsBot = isBotJid(ctx, ctx.mentionedJids?.[0]);
    const repliesToBot = isBotJid(ctx, ctx.quotedAuthor);

    let text = body.trim();
    // Only strip for the mention form: a reply carrying "invite @Juan" opens
    // with someone else's mention, which is an argument, not an address.
    if (mentionsBot) text = text.replace(LEADING_MENTION, '').trim();
    // "! join" is the same command as "!join" — a space slips in easily on a phone.
    text = text.replace(/^!\s+/, '!');

    const addressesBot = mentionsBot || repliesToBot;
    if (!text.startsWith('!') && !addressesBot) {
      return noCommand();
    }

    const tokens = this.tokenize(text);
    const [rawCommand, ...args] = tokens;
    if (!rawCommand) {
      return noCommand();
    }

    const word = `!${rawCommand.replace(/^!+/, '').toLowerCase()}`;
    const action = resolveCommand(word);
    if (action) {
      return { action, args };
    }

    // Every way of addressing the bot earns a did-you-mean, not just "!estadio":
    // mentioning the bot says who you are talking to as plainly as the "!" does.
    // Ordinary chatter never reaches this far — it returns above unless the
    // message opens with a "!" or addresses the bot.
    if (!COMMAND_WORD.test(word)) {
      return noCommand();
    }
    const suggestion = suggestCommand(word);
    return suggestion ? { action: undefined, args: [], unknown: { typed: rawCommand, suggestion } } : noCommand();
  }

  /**
   * Tokenizes a string into an array of arguments, respecting quotes.
   * Supports: "straight", “curly”, ‘single curly’, and 'single straight'.
   */
  static tokenize(text: string): string[] {
    const tokens: string[] = [];
    // This regex matches:
    // 1. Double quoted strings: "..."
    // 2. Smart double quoted strings: “...”
    // 3. Single quoted strings: '...'
    // 4. Smart single quoted strings: ‘...’
    // 5. Non-whitespace sequences
    const regex = /"[^"]*"|“[^”]*”|'[^']*'|‘[^’]*’|\S+/g;

    let match;
    while ((match = regex.exec(text)) !== null) {
      let token = match[0];
      // Remove surrounding quotes if present
      if ((token.startsWith('"') && token.endsWith('"')) ||
          (token.startsWith('“') && token.endsWith('”')) ||
          (token.startsWith("'") && token.endsWith("'")) ||
          (token.startsWith('‘') && token.endsWith('’'))) {
        token = token.slice(1, -1);
      }
      tokens.push(token);
    }

    return tokens;
  }
}

function isBotJid(ctx: ParseContext, jid: string | undefined): boolean {
  return !!jid && !!ctx.botJids?.includes(jid);
}
