import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

/**
 * The TanStack Router instance. The route tree is generated from the files in
 * `src/routes/` by the router Vite plugin. Route components are automatically
 * code-split (see vite.config.ts `autoCodeSplitting`), so the public Display and
 * Kiosk surfaces are excluded from the Dashboard's initial bundle (Req 1.8).
 */
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
