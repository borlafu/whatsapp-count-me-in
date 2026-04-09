# Random Groups Command (`!groups`)

## Summary

Admin-only command that randomly assigns the current event's joined participants into groups. Default group size is 4 members. The result is ephemeral (posted as a message, not saved to DB).

## Command Syntax

```
!groups [membersPerGroup]
```

- `membersPerGroup` is optional, defaults to 4
- Must be a positive integer >= 2

### Aliases

| English | Spanish |
|---------|---------|
| `!groups` | `!grupos` |
| `!draw` | `!sorteo` |

All aliases map to the canonical action `groups`.

## Behavior

1. Admin-only: non-admins get the standard `adminOnly` message.
2. Requires an active event — if none, show `noActiveEvent` message.
3. Pulls only "joined" participants from the active event.
4. If fewer than 2 joined participants, show an error (not enough to form groups).
5. If `membersPerGroup` >= joined count, show a single group with everyone.
6. Shuffle participants randomly.
7. Calculate number of groups: `ceil(joinedCount / membersPerGroup)`.
8. Distribute participants round-robin across groups. This naturally produces even distribution (e.g., 10 people in groups of 4 produces groups of 4, 3, 3).
9. Post the result as a message.

## Output Format

```
Random Groups (of 4):

Group 1:
- Alice
- Bob
- Carol
- Dave

Group 2:
- Eve
- Frank
- Grace
```

Guest participants display as `"Guest Name (Inviter's guest)"` using the existing i18n pattern.

## Changes by File

### `src/commandAliases.ts`

Add mappings:
- `!groups` -> `groups`
- `!grupos` -> `groups`
- `!draw` -> `groups`
- `!sorteo` -> `groups`

### `src/EventService.ts`

Add method:
```typescript
makeGroups(eventId: number, membersPerGroup: number = 4): Participant[][]
```

- Fetches joined participants from DB
- Shuffles them randomly (Fisher-Yates)
- Distributes round-robin into `ceil(count / membersPerGroup)` groups
- Returns array of arrays of Participant

### `src/CommandHandler.ts`

Add `groups` case in the switch:
1. Admin check
2. Get active event (or error)
3. Parse optional numeric arg (default 4, validate >= 2)
4. Call `service.makeGroups(event.id, membersPerGroup)`
5. Handle edge case: not enough participants
6. Format output message using i18n
7. Send via `safeReply`

### `src/i18n.ts`

New i18n keys (both EN and ES):

| Key | EN | ES |
|-----|----|----|
| `groupsHeader` | `Random Groups (of {0}):` | `Grupos Aleatorios (de {0}):` |
| `groupLabel` | `Group {0}:` | `Grupo {0}:` |
| `groupsNotEnough` | `Need at least 2 joined participants to form groups.` | `Se necesitan al menos 2 participantes para formar grupos.` |
| `groupsInvalidSize` | `Group size must be a number >= 2.` | `El tamano del grupo debe ser un numero >= 2.` |

### Tests

**`src/__tests__/EventService.test.ts`** — New tests:
- Groups of 4 with 8 participants -> 2 groups of 4
- Groups of 4 with 10 participants -> groups of 4, 3, 3
- Groups of 3 with 3 participants -> 1 group of 3
- All participants are assigned (no one lost)
- Each participant appears exactly once
- Returns empty array when no joined participants

**`src/__tests__/CommandHandler.test.ts`** — New tests:
- Admin can run `!groups` successfully
- Non-admin gets rejected
- Default group size is 4
- Custom group size `!groups 3`
- No active event error
- Not enough participants error
- Invalid argument error (e.g., `!groups abc`, `!groups 1`)

## Edge Cases

- **1 participant**: Show "not enough participants" error
- **0 participants**: Show "not enough participants" error
- **membersPerGroup >= participant count**: Single group with everyone
- **Non-numeric argument**: Show usage/invalid size error
- **membersPerGroup < 2**: Show invalid size error
- **Guests**: Display using existing guest name format from i18n
