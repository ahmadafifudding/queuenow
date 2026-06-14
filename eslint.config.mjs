// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Centralized flat ESLint config for the whole monorepo (ESLint 9).
 *
 * Linting is run from the repo root (`pnpm lint` -> `eslint .`) so every
 * workspace package is covered by one config without each needing its own
 * ESLint install. Type-aware rules are intentionally avoided to keep the setup
 * fast and free of per-package `parserOptions.project` wiring.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      // Prisma-generated artifacts and migrations are not hand-authored.
      'packages/database/prisma/**',
      // Generated artifacts in apps/web are not hand-authored: the TanStack
      // Router route tree and the openapi-typescript API schema. Excluding
      // them keeps the strict no-`any` gate focused on hand-written code.
      '**/routeTree.gen.ts',
      'apps/web/src/lib/api/schema.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Surface, don't block: these flag real smells but should not fail CI
      // while the codebase is still being built out.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // apps/web (R15.5): strict TypeScript quality gate — the web frontend must
    // pass type checking with NO use of the `any` type. Unlike the rest of the
    // monorepo (where `any` is a warning while code is built out), explicit
    // `any` in hand-written web code is a hard error so the `typecheck` gate
    // fails on it. Covers .tsx (React) in addition to .ts.
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
