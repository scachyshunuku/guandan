import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

const config: Config = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/.next/"],
  // next/jest rewrites plain `import ... from "@/..."` specifiers to
  // relative paths at compile time via its SWC transform, so most files
  // resolve the alias without any help here. But a bare string literal
  // passed to jest.mock("@/...") is never touched by that transform - it
  // goes straight to Jest's own resolver, which has no idea what "@/" means
  // without this mapping (surfaces as "Cannot find module").
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};

export default createJestConfig(config);
