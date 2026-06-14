// Metro configuration for the pnpm monorepo.
// Based on the standard Expo monorepo setup:
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
// The workspace root is two levels up (apps/mobile -> repo root).
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so changes in `packages/*` trigger rebuilds.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the app first, then the workspace root. pnpm hoists
//    shared deps to the root `node_modules`, so both paths are required.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Enable symlink resolution so the symlinked `@queuenow/*` workspace packages
//    (linked by pnpm) resolve correctly.
config.resolver.unstable_enableSymlinks = true;

// 4. With pnpm's strict, non-hoisted layout we must not fall back to the
//    hierarchical `node_modules` lookup, which can resolve the wrong copy.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
