---
name: typescript
description: TypeScript modelling conventions for hive. Use when writing or reviewing types, domain models, services, or IO boundaries.
---

# TypeScript

- Use clear discriminated unions for domain models, with a focused doc string on every field of no more than 3–5 lines.
- Avoid optionals when a union models the domain better: an explicit variant beats `field?:` when the missing case has its own meaning.
- All IO lives at the application boundary, managed by dependency injection and services. Keep domain code pure.

```ts
// Prefer
type Lookup = { kind: "found"; user: User } | { kind: "missing"; id: string };
// Over
type Lookup = { user?: User };
```
