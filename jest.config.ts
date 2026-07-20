import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

const config: Config = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/.next/"],
  // next/jest's SWC transform resolves the `@/*` tsconfig path alias for
  // ordinary import/require specifiers, but not for bare strings passed to
  // jest.mock()/jest.requireActual() — those go through Jest's own
  // resolver, which needs the mapping spelled out here too.
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};

export default createJestConfig(config);
