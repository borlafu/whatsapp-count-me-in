/** Maps all accepted command strings (EN + ES) to canonical action names. */
const aliases: Record<string, string> = {
  '!create': 'create',
  '!crear': 'create',
  '!join': 'join',
  '!in': 'join',
  '!count': 'join',
  '!countmein': 'join',
  '!countonme': 'join',
  '!add': 'join',
  '!unir': 'join',
  '!unirme': 'join',
  '!unirse': 'join',
  '!apuntame': 'join',
  '!apuntar': 'join',
  '!apuntarme': 'join',
  '!entrar': 'join',
  '!dentro': 'join',
  '!waitlist': 'waitlist',
  '!onhold': 'waitlist',
  '!espera': 'waitlist',
  '!reserva': 'waitlist',
  '!leave': 'leave',
  '!out': 'leave',
  '!remove': 'leave',
  '!salir': 'leave',
  '!fuera': 'leave',
  '!quitar': 'leave',
  '!status': 'status',
  '!info': 'status',
  '!estado': 'status',
  '!cancel': 'cancel',
  '!cancelar': 'cancel',
  '!anular': 'cancel',
  '!conclude': 'conclude',
  '!finish': 'conclude',
  '!concluir': 'conclude',
  '!finalizar': 'conclude',
  '!resize': 'resize',
  '!redimensionar': 'resize',
  '!plazas': 'resize',
  '!rename': 'rename',
  '!renombrar': 'rename',
  '!nombre': 'rename',
  '!lang': 'lang',
  '!idioma': 'lang',
  '!invite': 'invite',
  '!invitar': 'invite',
  '!help': 'help',
  '!ayuda': 'help',
  '!groups': 'groups',
  '!grupos': 'groups',
  '!draw': 'groups',
  '!sorteo': 'groups',
  '!reschedule': 'reschedule',
  '!reprogramar': 'reschedule',
  '!reminders': 'reminders',
  '!recordatorios': 'reminders',
};

export function resolveCommand(raw: string): string | undefined {
  return aliases[raw];
}

/** Every canonical action the aliases resolve to. */
export function knownActions(): string[] {
  return [...new Set(Object.values(aliases))];
}

/**
 * How far a typo may sit from a real command before guessing stops being
 * helpful. Short words are held to one edit: "!ok" is two edits from "!in",
 * but someone typing "!ok" in a group meant "ok", not a command.
 */
const maxSuggestionDistance = (word: string): number => (word.length >= 5 ? 2 : 1);

/**
 * Finds the command a mistyped one most likely meant, or undefined when
 * nothing is close enough to be worth guessing.
 *
 * The alias keys carry the leading "!", so `raw` must too — comparing a
 * stripped word against prefixed keys costs one edit on every candidate.
 */
export function suggestCommand(raw: string): string | undefined {
  const limit = maxSuggestionDistance(raw);
  let best: string | undefined;
  let bestDistance = limit + 1;

  for (const candidate of Object.keys(aliases)) {
    // A length gap alone already costs that many edits, so skip the matrix.
    if (Math.abs(candidate.length - raw.length) > limit) continue;

    const distance = editDistance(raw, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return bestDistance <= limit ? best : undefined;
}

/** Levenshtein distance, keeping only the two rows it needs. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, substitution);
    }
    previous = current;
  }

  return previous[b.length]!;
}
