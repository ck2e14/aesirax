# TypeScript Style Guide

## Naming Conventions

-  **Constants**: UPPER_SNAKE_CASE

   -  Example: `const MAX_UINT16 = 65_535;`

-  **Enums**:

   -  Enum names: PascalCase
   -  Enum members: UPPER_SNAKE_CASE
   -  Example:
      ```typescript
      enum DicomErrorType {
         VALIDATE = "VALIDATE",
      }
      ```

-  **Object-like constants**: PascalCase

   -  Example: `const TagDictByName = { ... };`

-  **Functions**: camelCase

   -  Example: `function parseTag() { ... }`

-  **Variables**: camelCase

   -  Example: `let cursor: Cursor;`

-  **Types**: PascalCase

   -  Example: `type ParseResult = { ... };`

-  **Type Aliases**: PascalCase
   -  Example: `type Element = { ... };`

## General Rules

-  Use TypeScript's type system consistently.
-  Prefer `const` over `let` when the value won't be reassigned.
-  Use semicolons at the end of statements.
-  Use single quotes for string literals unless the string contains single quotes.
-  Comments are treated as natural language and are not subject to code naming conventions.

## Export/Import

-  Use named exports/imports when possible.
-  Use default export sparingly, typically for main component/function of a module.

## Error Handling

-  Use custom error classes for specific error types.
-  Prefer throwing typed errors over generic Error instances.

## Function Parameters

-  Use type annotations for function parameters.
-  Consider using interface or type alias for complex parameter types.

## Code Organization

-  Group related functionality into modules.
-  Use barrel files (index.ts) to simplify imports from complex module structures.

Remember to keep this style guide updated as your project evolves and new conventions are agreed upon.
