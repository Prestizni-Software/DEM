import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
    globals: {
        "ts-jest": {
            useESM: true
        }
    },
    transform: { '\\.[jt]s?$': ['ts-jest', { tsconfig: { allowJs: true } }] },  
    preset: 'ts-jest/presets/default-esm',
    roots: ["tests/"],
    modulePathIgnorePatterns: [
        "node_modules/"
    ], moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.[jt]s$': '$1',
  },
};

export default config;