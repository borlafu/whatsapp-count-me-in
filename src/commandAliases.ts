/** Maps all accepted command strings (EN + ES) to canonical action names. */
const aliases: Record<string, string> = {
  '!create': 'create',
  '!crear': 'create',
  '!join': 'join',
  '!countmein': 'join',
  '!countonme': 'join',
  '!unirme': 'join',
  '!unirse': 'join',
  '!apuntame': 'join',
  '!waitlist': 'waitlist',
  '!onhold': 'waitlist',
  '!espera': 'waitlist',
  '!reserva': 'waitlist',
  '!leave': 'leave',
  '!salir': 'leave',
  '!status': 'status',
  '!estado': 'status',
  '!cancel': 'cancel',
  '!cancelar': 'cancel',
  '!lang': 'lang',
  '!idioma': 'lang',
  '!help': 'help',
  '!ayuda': 'help',
};

export function resolveCommand(raw: string): string | undefined {
  return aliases[raw];
}
