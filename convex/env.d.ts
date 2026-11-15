// Minimal Node globals available in the Convex runtime (no @types/node in this repo).
declare const process: { env: Record<string, string | undefined> };
// scripts/re/lib/template.ts references Buffer behind a runtime guard.
declare const Buffer: { from(data: string, encoding: string): { toString(encoding: string): string } };
