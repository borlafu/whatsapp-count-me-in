```markdown
# whatsapp-count-me-in Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you the core development patterns and conventions used in the `whatsapp-count-me-in` TypeScript repository. You'll learn about file naming, import/export styles, commit message conventions, and how to write and run tests. While no frameworks or automated workflows were detected, this guide provides best practices and helpful commands for efficient development.

## Coding Conventions

### File Naming
- Use **PascalCase** for file names.
  - Example: `UserService.ts`, `MessageHandler.ts`

### Import Style
- Use **relative imports** to reference other files.
  - Example:
    ```typescript
    import { UserService } from './UserService';
    ```

### Export Style
- Use **named exports** for functions, classes, and constants.
  - Example:
    ```typescript
    export function countParticipants() { ... }
    export class MessageHandler { ... }
    ```

### Commit Messages
- Follow **Conventional Commits**.
- Use prefixes like `feat` for features and `chore` for maintenance.
- Keep messages concise (average ~42 characters).
  - Example:
    ```
    feat: add participant counting logic
    chore: update dependencies
    ```

## Workflows

### Creating a New Feature
**Trigger:** When adding new functionality  
**Command:** `/new-feature`

1. Create a new PascalCase file for your feature.
2. Use relative imports to include any dependencies.
3. Export your feature using named exports.
4. Write a commit message starting with `feat:`.
5. Example:
    ```typescript
    // UserCounter.ts
    export function countUsers(users: string[]): number {
      return users.length;
    }
    ```
    ```
    feat: implement user counting utility
    ```

### Refactoring or Maintenance
**Trigger:** When updating dependencies or refactoring code  
**Command:** `/chore`

1. Make necessary changes or updates.
2. Use relative imports and named exports as needed.
3. Write a commit message starting with `chore:`.
    ```
    chore: refactor message handler logic
    ```

### Writing and Running Tests
**Trigger:** When adding or updating tests  
**Command:** `/test`

1. Create a test file with the pattern `*.test.*` (e.g., `UserService.test.ts`).
2. Write your tests using your preferred testing framework (not specified).
3. Run your tests using the appropriate command for your setup.

## Testing Patterns

- Test files follow the `*.test.*` naming convention.
  - Example: `UserService.test.ts`
- The specific testing framework is not defined; use your team's standard.
- Place test files alongside the modules they test or in a dedicated test directory.

## Commands
| Command        | Purpose                              |
|----------------|--------------------------------------|
| /new-feature   | Start a new feature implementation   |
| /chore         | Perform maintenance or refactoring   |
| /test          | Add or run tests                     |
```
