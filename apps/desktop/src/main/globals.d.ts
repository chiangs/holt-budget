/**
 * Set by `electron.vite.config.ts` from the build mode. Both are false in a production build, so the bundler
 * drops every branch that reads them and the development seed never reaches the shipped app.
 */
declare const __HOLT_DEV_SEED__: boolean;
declare const __HOLT_E2E__: boolean;
