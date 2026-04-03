import { resolveCommand } from './commandAliases.js';

export interface ParsedCommand {
  action: string | undefined;
  args: string[];
}

export class CommandParser {
  /**
   * Parses a message body into a canonical action and an array of arguments.
   * Supports quoted strings (straight and smart quotes).
   */
  static parse(body: string): ParsedCommand {
    const trimmedBody = body.trim();
    if (!trimmedBody.startsWith('!')) {
      return { action: undefined, args: [] };
    }

    const tokens = this.tokenize(trimmedBody);
    const [rawCommand, ...args] = tokens;
    if (!rawCommand) {
      return { action: undefined, args: [] };
    }

    const action = resolveCommand(rawCommand.toLowerCase());
    return { action, args };
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
