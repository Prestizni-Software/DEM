import type { JestConfigWithTsJest } from 'ts-jest';

const config: JestConfigWithTsJest = {
    transform: {
        '\\.[jt]s?$': ['ts-jest', { useESM: true, tsconfig: { allowJs: true } }],
    },  
    preset: 'ts-jest/presets/default-esm',
    roots: ["tests/"],
    modulePathIgnorePatterns: [
        "node_modules/"
    ],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.[jt]s$': '$1',
    },
};

export default config;
