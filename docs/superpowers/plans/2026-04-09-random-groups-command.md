# Random Groups Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only `!groups` command that randomly assigns joined participants into evenly-distributed groups.

**Architecture:** Business logic (shuffle + distribute) lives in `EventService.makeGroups()`. `CommandHandler` routes the command, validates args, and formats the output message. i18n keys support EN/ES.

**Tech Stack:** TypeScript, Vitest, better-sqlite3 (in-memory for tests)

---

### Task 1: Add command aliases

**Files:**
- Modify: `src/commandAliases.ts:2-44`

- [ ] **Step 1: Add the four aliases**

In `src/commandAliases.ts`, add these entries before the closing `};` on line 44:

```typescript
  '!groups': 'groups',
  '!grupos': 'groups',
  '!draw': 'groups',
  '!sorteo': 'groups',
```

- [ ] **Step 2: Run existing tests to verify nothing broke**

Run: `npx vitest run src/__tests__/CommandParser.test.ts`
Expected: All existing tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/commandAliases.ts
git commit -m "feat: add command aliases for !groups/!grupos/!draw/!sorteo"
```

---

### Task 2: Add i18n keys

**Files:**
- Modify: `src/i18n.ts:3-65` (interface), `src/i18n.ts:67-171` (messages)

- [ ] **Step 1: Add interface entries**

In `src/i18n.ts`, add these entries to the `MessageTemplates` interface after the `statusGuest` line (line 61):

```typescript
  // Groups
  groupsHeader: (size: number) => string;
  groupLabel: (index: number) => string;
  groupsNotEnough: () => string;
  groupsInvalidSize: () => string;
```

- [ ] **Step 2: Add English messages**

In the `en` object, add after the `statusGuest` entry (line 105):

```typescript
    groupsHeader: (size) => `Random Groups (of ${size}):`,
    groupLabel: (index) => `Group ${index}:`,
    groupsNotEnough: () => 'Need at least 2 joined participants to form groups.',
    groupsInvalidSize: () => 'Group size must be a number 2 or greater. Usage: !groups [size]',
```

- [ ] **Step 3: Add Spanish messages**

In the `es` object, add after the `statusGuest` entry (line 157):

```typescript
    groupsHeader: (size) => `Grupos Aleatorios (de ${size}):`,
    groupLabel: (index) => `Grupo ${index}:`,
    groupsNotEnough: () => 'Se necesitan al menos 2 participantes para formar grupos.',
    groupsInvalidSize: () => 'El tamano del grupo debe ser un numero de 2 o mayor. Uso: !grupos [tamano]',
```

- [ ] **Step 4: Add !groups/!draw to the help messages**

In the English `helpMessage` (around line 118), add before the `*!help*` line:

```typescript
      `*!groups [size]*  — Randomly assign participants into groups (admin only)\n` +
```

In the Spanish `helpMessage` (around line 170), add before the `*!ayuda*` line:

```typescript
      `*!grupos [tamano]*  — Asignar participantes en grupos aleatorios (solo admins)\n` +
```

- [ ] **Step 5: Run existing tests**

Run: `npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/i18n.ts
git commit -m "feat: add i18n keys for groups command (EN/ES)"
```

---

### Task 3: Implement EventService.makeGroups with TDD

**Files:**
- Test: `src/__tests__/EventService.test.ts`
- Modify: `src/EventService.ts:233`

- [ ] **Step 1: Write failing tests**

Add this `describe` block at the end of the `EventService` describe in `src/__tests__/EventService.test.ts` (before the closing `});`):

```typescript
  describe('makeGroups', () => {
    it('should split 8 participants into 2 groups of 4', () => {
      service.createEvent(chatId, 'Test Event', 10, adminId);
      const event = db.getActiveEvent(chatId)!;
      for (let i = 1; i <= 8; i++) {
        db.addParticipant(event.id, `user${i}@s.whatsapp.net`, `User ${i}`, 'joined');
      }

      const groups = service.makeGroups(event.id, 4);
      expect(groups).toHaveLength(2);
      expect(groups[0]).toHaveLength(4);
      expect(groups[1]).toHaveLength(4);
    });

    it('should distribute 10 participants into groups of 4 as 4,3,3', () => {
      service.createEvent(chatId, 'Test Event', 12, adminId);
      const event = db.getActiveEvent(chatId)!;
      for (let i = 1; i <= 10; i++) {
        db.addParticipant(event.id, `user${i}@s.whatsapp.net`, `User ${i}`, 'joined');
      }

      const groups = service.makeGroups(event.id, 4);
      expect(groups).toHaveLength(3);
      const sizes = groups.map(g => g.length).sort((a, b) => b - a);
      expect(sizes).toEqual([4, 3, 3]);
    });

    it('should return a single group when membersPerGroup >= participant count', () => {
      service.createEvent(chatId, 'Test Event', 5, adminId);
      const event = db.getActiveEvent(chatId)!;
      db.addParticipant(event.id, user1, 'User One', 'joined');
      db.addParticipant(event.id, user2, 'User Two', 'joined');

      const groups = service.makeGroups(event.id, 4);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(2);
    });

    it('should include every participant exactly once', () => {
      service.createEvent(chatId, 'Test Event', 12, adminId);
      const event = db.getActiveEvent(chatId)!;
      for (let i = 1; i <= 7; i++) {
        db.addParticipant(event.id, `user${i}@s.whatsapp.net`, `User ${i}`, 'joined');
      }

      const groups = service.makeGroups(event.id, 3);
      const allIds = groups.flat().map(p => p.user_id);
      expect(allIds).toHaveLength(7);
      expect(new Set(allIds).size).toBe(7);
    });

    it('should only include joined participants, not waitlisted', () => {
      service.createEvent(chatId, 'Test Event', 2, adminId);
      const event = db.getActiveEvent(chatId)!;
      db.addParticipant(event.id, user1, 'User One', 'joined');
      db.addParticipant(event.id, user2, 'User Two', 'waitlisted');

      const groups = service.makeGroups(event.id, 4);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(1);
      expect(groups[0][0].user_id).toBe(user1);
    });

    it('should return empty array when no joined participants', () => {
      service.createEvent(chatId, 'Test Event', 5, adminId);
      const event = db.getActiveEvent(chatId)!;

      const groups = service.makeGroups(event.id, 4);
      expect(groups).toHaveLength(0);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/EventService.test.ts`
Expected: FAIL — `service.makeGroups is not a function`

- [ ] **Step 3: Implement makeGroups**

Add this method to `EventService` in `src/EventService.ts`, after the `getStatus` method (after line 232):

```typescript
  makeGroups(eventId: number, membersPerGroup: number = 4): Participant[] [] {
    const participants = this.db.getParticipants(eventId);
    const joined = participants.filter(p => p.status === 'joined');

    if (joined.length === 0) return [];

    // Fisher-Yates shuffle
    for (let i = joined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [joined[i], joined[j]] = [joined[j], joined[i]];
    }

    const numGroups = Math.ceil(joined.length / membersPerGroup);
    const groups: Participant[][] = Array.from({ length: numGroups }, () => []);

    // Round-robin distribution
    for (let i = 0; i < joined.length; i++) {
      groups[i % numGroups].push(joined[i]);
    }

    return groups;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/EventService.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/EventService.ts src/__tests__/EventService.test.ts
git commit -m "feat: add EventService.makeGroups with TDD tests"
```

---

### Task 4: Implement CommandHandler.handleGroups with TDD

**Files:**
- Test: `src/__tests__/CommandHandler.test.ts`
- Modify: `src/CommandHandler.ts:36-72`

- [ ] **Step 1: Write failing tests**

Add this `describe` block at the end of the `CommandHandler` describe in `src/__tests__/CommandHandler.test.ts` (before the closing `});`):

```typescript
  describe('!groups', () => {
    it('should deny non-admin', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: userId, admin: null }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      await handler.handleCommand(createMockMsg('!groups'), mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('Only group admins')
      }), expect.anything());
    });

    it('should show error when no active event', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      const msg = createMockMsg('!groups', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('No active event')
      }), expect.anything());
    });

    it('should show error when fewer than 2 joined participants', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      service.joinEvent(chatId, userId, 'User');
      const msg = createMockMsg('!groups', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('at least 2')
      }), expect.anything());
    });

    it('should show error for invalid group size', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      const msg = createMockMsg('!groups abc', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('must be a number')
      }), expect.anything());
    });

    it('should show error for group size less than 2', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      const msg = createMockMsg('!groups 1', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('must be a number')
      }), expect.anything());
    });

    it('should default to groups of 4', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      for (let i = 1; i <= 8; i++) {
        service.joinEvent(chatId, `u${i}@s.whatsapp.net`, `User ${i}`);
      }
      const msg = createMockMsg('!groups', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringMatching(/Random Groups \(of 4\)/)
      }), expect.anything());
    });

    it('should accept custom group size', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      for (let i = 1; i <= 6; i++) {
        service.joinEvent(chatId, `u${i}@s.whatsapp.net`, `User ${i}`);
      }
      const msg = createMockMsg('!groups 3', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringMatching(/Random Groups \(of 3\)/)
      }), expect.anything());
    });

    it('should display group labels and participant names', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Party', 10, adminId);
      service.joinEvent(chatId, 'u1@s.whatsapp.net', 'Alice');
      service.joinEvent(chatId, 'u2@s.whatsapp.net', 'Bob');
      service.joinEvent(chatId, 'u3@s.whatsapp.net', 'Carol');
      const msg = createMockMsg('!groups 2', true, adminId);
      await handler.handleCommand(msg, mockSock);
      const sentText = mockSock.sendMessage.mock.calls[0][1].text;
      expect(sentText).toContain('Group 1:');
      expect(sentText).toContain('Group 2:');
    });

    it('should work with Spanish alias !sorteo', async () => {
      mockSock.groupMetadata.mockResolvedValue({ participants: [{ id: adminId, admin: 'admin' }] });
      service.createEvent(chatId, 'Fiesta', 10, adminId);
      service.joinEvent(chatId, 'u1@s.whatsapp.net', 'Alice');
      service.joinEvent(chatId, 'u2@s.whatsapp.net', 'Bob');
      const msg = createMockMsg('!sorteo', true, adminId);
      await handler.handleCommand(msg, mockSock);
      expect(mockSock.sendMessage).toHaveBeenCalledWith(chatId, expect.objectContaining({
        text: expect.stringContaining('Group')
      }), expect.anything());
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/CommandHandler.test.ts`
Expected: FAIL — no `groups` case in the switch

- [ ] **Step 3: Add the groups case to the switch statement**

In `src/CommandHandler.ts`, add this case in the switch block before the `default` case (before line 70):

```typescript
        case 'groups':
          await this.handleGroups(msg, chatId, senderId, args, sock, locale);
          break;
```

- [ ] **Step 4: Implement handleGroups method**

Add this method to `CommandHandler` in `src/CommandHandler.ts`, after the `handleCancel` method (after line 206):

```typescript
  private async handleGroups(msg: WAMessage, chatId: string, userId: string, args: string[], sock: WASocket, locale: Locale) {
    if (!(await this.isAdmin(chatId, userId, sock))) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'adminOnly'));
    }

    const event = this.db.getActiveEvent(chatId);
    if (!event) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'noActiveEvent'));
    }

    let membersPerGroup = 4;
    if (args[0]) {
      membersPerGroup = parseInt(args[0]);
      if (isNaN(membersPerGroup) || membersPerGroup < 2) {
        return await this.safeReply(msg, chatId, sock, t(locale, 'groupsInvalidSize'));
      }
    }

    const groups = this.eventService.makeGroups(event.id, membersPerGroup);
    const totalParticipants = groups.reduce((sum, g) => sum + g.length, 0);

    if (totalParticipants < 2) {
      return await this.safeReply(msg, chatId, sock, t(locale, 'groupsNotEnough'));
    }

    let text = `${t(locale, 'groupsHeader', membersPerGroup)}\n`;
    groups.forEach((group, i) => {
      text += `\n${t(locale, 'groupLabel', i + 1)}\n`;
      group.forEach(p => {
        const displayName = p.invited_by
          ? t(locale, 'statusGuest', p.user_name, p.invited_by_name || 'Admin')
          : p.user_name;
        text += `- ${displayName}\n`;
      });
    });

    await this.safeReply(msg, chatId, sock, text);
  }
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/CommandHandler.ts src/__tests__/CommandHandler.test.ts
git commit -m "feat: add !groups command handler with TDD tests"
```
