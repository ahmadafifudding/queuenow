/*
 * Expo app configuration (TypeScript) — replaces the static `app.json`.
 *
 * Expo precedence: when both `app.json` and `app.config.ts` exist, the dynamic
 * config takes precedence and is the single source of truth. To avoid two files
 * with conflicting content, `app.json` has been removed and ALL configuration
 * now lives here.
 *
 * This config:
 * - preserves every value previously in `app.json` (name, slug, scheme, the
 *   expo-router plugin, typed routes, platform settings, etc.);
 * - reads the public environment (`EXPO_PUBLIC_*`) and surfaces it through
 *   `extra` so `expo-constants` can serve it as a fallback to `lib/env.ts`;
 * - registers the native Expo plugins the design calls for: expo-camera
 *   (QR scanning), expo-secure-store (token storage), and expo-notifications
 *   (turn alerts).
 *
 * No URLs are hardcoded here — env values flow straight from `process.env`.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'QueueNow',
  slug: 'queuenow-mobile',
  scheme: 'queuenow',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  // Note: the New Architecture is enabled by default in SDK 56, so the previous
  // `newArchEnabled` flag (from app.json) is no longer a config option and has
  // been dropped — it is now the built-in default.
  ios: {
    supportsTablet: true,
  },
  // Note: Android edge-to-edge is the default in SDK 56, so the previous
  // `android.edgeToEdgeEnabled` flag (from app.json) is no longer a config
  // option and has been dropped — the behavior it requested is now built in.
  web: {
    bundler: 'metro',
    output: 'static',
  },
  plugins: ['expo-router', 'expo-camera', 'expo-secure-store', 'expo-notifications'],
  experiments: {
    typedRoutes: true,
  },
  // Surface validated public config through expo-constants as a fallback source
  // for `lib/env.ts`. `process.env.EXPO_PUBLIC_*` remains authoritative.
  extra: {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_WS_URL: process.env.EXPO_PUBLIC_WS_URL,
  },
});
