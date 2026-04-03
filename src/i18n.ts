export type Locale = 'en' | 'es';

interface MessageTemplates {
  // Admin
  adminOnly: () => string;

  // Language
  langChanged: (lang: string) => string;
  langUsage: () => string;
  langInvalid: () => string;

  // Create
  createUsage: () => string;
  eventCreated: (title: string, slots: number) => string;
  activeEventExists: () => string;

  // Join
  noActiveEvent: () => string;
  alreadyJoined: () => string;
  alreadyWaitlisted: () => string;
  joined: (mention: string, title: string) => string;
  joinedWaitlist: (mention: string, title: string) => string;
  confirmedSpot: (mention: string, title: string) => string;
  eventFullNoWaitlist: () => string;

  // Leave
  notSignedUp: () => string;
  withdrawn: (mention: string, title: string) => string;

  // Resize
  resizeUsage: () => string;
  resizeInvalidSlots: () => string;
  eventResized: (title: string, slots: number) => string;

  // Rename
  renameUsage: () => string;
  eventRenamed: (oldTitle: string, newTitle: string) => string;

  // Cancel
  noActiveEventCancel: () => string;
  eventCancelled: (title: string) => string;

  // Status
  noActiveEventStatus: () => string;
  statusHeader: (title: string) => string;
  statusSlots: (joined: number, total: number) => string;
  statusParticipants: () => string;
  statusPendingTag: () => string;
  statusWaitlist: () => string;

  // Promotion
  slotOpened: (mention: string, title: string) => string;

  // Help
  helpMessage: () => string;
}

const messages: Record<Locale, MessageTemplates> = {
  en: {
    adminOnly: () => 'Only group admins can do this.',
    langChanged: (lang) => `🌐 Language changed to *${lang === 'en' ? 'English' : 'Spanish'}*.`,
    langUsage: () => 'Usage: !lang en|es',
    langInvalid: () => 'Supported languages: en, es',
    createUsage: () => 'Usage: !create "Event Title" [Max Slots]',
    eventCreated: (title, slots) => `✅ Event "${title}" created!\nSlots: ${slots}\nUse !join to sign up.`,
    activeEventExists: () => 'There is already an active event in this group.',
    noActiveEvent: () => 'No active event in this group.',
    alreadyJoined: () => 'You are already signed up.',
    alreadyWaitlisted: () => 'You are already on the waitlist.',
    joined: (mention, title) => `✅ @${mention}, you have joined "${title}".`,
    joinedWaitlist: (mention, title) => `⏳ @${mention}, you have been added to the waitlist for "${title}".`,
    confirmedSpot: (mention, title) => `✅ @${mention}, you have confirmed your spot in "${title}"!`,
    eventFullNoWaitlist: () => 'Sorry, the event is full and waitlist is disabled.',
    notSignedUp: () => 'You are not signed up for this event.',
    withdrawn: (mention, title) => `❌ @${mention}, you have withdrawn from "${title}".`,
    noActiveEventCancel: () => 'No active event to cancel.',
    eventCancelled: (title) => `🛑 Event "${title}" has been cancelled.`,
    resizeUsage: () => 'Usage: !resize <new_slots>',
    resizeInvalidSlots: () => 'Slots must be a positive number.',
    eventResized: (title, slots) => `✅ Event "${title}" updated to ${slots} slot(s).`,
    renameUsage: () => 'Usage: !rename "New Title"',
    eventRenamed: (oldTitle, newTitle) => `✅ Event renamed from "${oldTitle}" to "${newTitle}".`,
    noActiveEventStatus: () => 'No active event.',
    statusHeader: (title) => `📊 *${title}*`,
    statusSlots: (joined, total) => `Slots: ${joined}/${total}`,
    statusParticipants: () => '✅ *Participants:*',
    statusPendingTag: () => '(Pending)',
    statusWaitlist: () => '⏳ *Waitlist:*',
    slotOpened: (mention, title) => `🔊 Attention @${mention}! A slot opened up for "${title}".\nReply with !join to confirm or !leave to decline.`,
    helpMessage: () =>
      `📖 *Count Me In — Commands*\n\n` +
      `*!create "Title" <slots>*  — Create an event (admin only)\n` +
      `*!join*  — Sign up for the active event\n` +
      `*!waitlist*  — Join the waitlist directly\n` +
      `*!leave*  — Withdraw from the event\n` +
      `*!status*  — View event status & participants\n` +
      `*!resize <slots>*  — Update max slots (admin only)\n` +
      `*!rename "New Title"*  — Rename the active event (admin only)\n` +
      `*!cancel*  — Cancel the active event (admin only)\n` +
      `*!lang en|es*  — Change bot language (admin only)\n` +
      `*!help*  — Show this message`,
  },
  es: {
    adminOnly: () => 'Solo los administradores del grupo pueden hacer esto.',
    langChanged: (lang) => `🌐 Idioma cambiado a *${lang === 'en' ? 'Inglés' : 'Español'}*.`,
    langUsage: () => 'Uso: !idioma en|es',
    langInvalid: () => 'Idiomas disponibles: en, es',
    createUsage: () => 'Uso: !crear "Título del Evento" [Plazas]',
    eventCreated: (title, slots) => `✅ Evento "${title}" creado!\nPlazas: ${slots}\nUsa !unirse para apuntarte.`,
    activeEventExists: () => 'Ya hay un evento activo en este grupo.',
    noActiveEvent: () => 'No hay ningún evento activo en este grupo.',
    alreadyJoined: () => 'Ya estás apuntado/a.',
    alreadyWaitlisted: () => 'Ya estás en la lista de espera.',
    joined: (mention, title) => `✅ @${mention}, te has unido a "${title}".`,
    joinedWaitlist: (mention, title) => `⏳ @${mention}, has sido añadido/a a la lista de espera de "${title}".`,
    confirmedSpot: (mention, title) => `✅ @${mention}, has confirmado tu plaza en "${title}"!`,
    eventFullNoWaitlist: () => 'Lo sentimos, el evento está lleno y la lista de espera está desactivada.',
    notSignedUp: () => 'No estás apuntado/a a este evento.',
    withdrawn: (mention, title) => `❌ @${mention}, te has retirado de "${title}".`,
    noActiveEventCancel: () => 'No hay ningún evento activo que cancelar.',
    eventCancelled: (title) => `🛑 El evento "${title}" ha sido cancelado.`,
    resizeUsage: () => 'Uso: !resize <nuevas_plazas>',
    resizeInvalidSlots: () => 'Las plazas deben ser un número positivo.',
    eventResized: (title, slots) => `✅ El evento "${title}" ha sido actualizado a ${slots} plaza(s).`,
    renameUsage: () => 'Uso: !renombrar "Nuevo Título"',
    eventRenamed: (oldTitle, newTitle) => `✅ Evento renombrado de "${oldTitle}" a "${newTitle}".`,
    noActiveEventStatus: () => 'No hay ningún evento activo.',
    statusHeader: (title) => `📊 *${title}*`,
    statusSlots: (joined, total) => `Plazas: ${joined}/${total}`,
    statusParticipants: () => '✅ *Participantes:*',
    statusPendingTag: () => '(Pendiente)',
    statusWaitlist: () => '⏳ *Lista de espera:*',
    slotOpened: (mention, title) => `🔊 ¡Atención @${mention}! Se ha liberado una plaza en "${title}".\nResponde con !unirse para confirmar o !salir para rechazar.`,
    helpMessage: () =>
      `📖 *Count Me In — Comandos*\n\n` +
      `*!crear "Título" <plazas>*  — Crear un evento (solo admins)\n` +
      `*!unirse*  — Apuntarse al evento activo\n` +
      `*!espera*  — Unirse a la lista de espera\n` +
      `*!salir*  — Retirarse del evento\n` +
      `*!estado*  — Ver estado y participantes\n` +
      `*!resize <plazas>*  — Actualizar plazas máximas (solo admins)\n` +
      `*!renombrar "Nuevo Título"*  — Renombrar el evento activo (solo admins)\n` +
      `*!cancelar*  — Cancelar el evento activo (solo admins)\n` +
      `*!idioma en|es*  — Cambiar idioma del bot (solo admins)\n` +
      `*!ayuda*  — Mostrar este mensaje`,
  },
};

export function t<K extends keyof MessageTemplates>(
  locale: Locale,
  key: K,
  ...args: Parameters<MessageTemplates[K]>
): string {
  const fn = messages[locale][key] as (...a: any[]) => string;
  return fn(...args);
}
