import '@testing-library/jest-dom/vitest';

import { expect } from 'vitest';
import { toHaveNoViolations } from 'vitest-axe/dist/matchers';
import type { AxeMatchers } from 'vitest-axe/dist/matchers';

// Wire the vitest-axe accessibility matcher into Vitest's `expect` so the a11y
// smoke tests (task 18.2) can assert `expect(container).toHaveNoViolations()`.
//
// Notes on the imports above:
// - The matcher is imported from `vitest-axe/dist/matchers` because the package
//   root `vitest-axe/matchers` re-exports everything with `export type *`, which
//   strips the runtime value under `verbatimModuleSyntax`. The `dist` entry
//   re-exports it as a real value.
// - vitest-axe also ships an `extend-expect` entry, but it augments the legacy
//   global `Vi` namespace that Vitest 2 no longer reads, so we register the
//   matcher explicitly and add the type augmentation below (no `any`).
expect.extend({ toHaveNoViolations });

declare module 'vitest' {
  // Merge vitest-axe's matchers into Vitest's assertion interfaces. The generic
  // parameter mirrors Vitest's own `Assertion<T>` (its default is declared
  // upstream, so we omit it here to keep the declarations compatible). These
  // are intentionally empty — they only pull in `AxeMatchers` via declaration
  // merging — so the empty-interface lint rule is not meaningful here.
  /* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars */
  interface Assertion<T> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
  /* eslint-enable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars */
}
