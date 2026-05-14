import baseConfig from '@pulse/eslint-config/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**'],
  },
];
