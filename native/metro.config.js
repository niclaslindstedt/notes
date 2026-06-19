// Metro is configured to reach the shared core under <repoRoot>/src. The
// React Native app is a thin presentation layer over the same domain,
// storage, and app-state code the web PWA runs — see native/README.md.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Watch the repo root so Metro transforms and hot-reloads the shared
// modules in ../src as if they were part of this app.
config.watchFolders = [repoRoot];

// Resolve packages from the native app's node_modules first, then fall
// back to the repo root's. Pinning the singletons keeps the shared hooks
// bound to the very same React/React Native instance the renderer uses —
// a second copy of React would break the rules of hooks.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(repoRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

const singletons = ["react", "react-native"];
config.resolver.extraNodeModules = singletons.reduce((acc, name) => {
  acc[name] = path.resolve(projectRoot, "node_modules", name);
  return acc;
}, {});

module.exports = config;
