/**
 * Please do not edit this file 🙈
 */
export default {
   preset: "ts-jest/presets/js-with-ts-esm",
   verbose: true,
   extensionsToTreatAsEsm: [".ts"],
   testEnvironment: "node",
   testMatch: ["**/*.test.ts", "**/*.spec.ts"],
   testPathIgnorePatterns: ["/node_modules/", "/dist/"],
   transform: {},
   resolver: "jest-resolver-enhanced",
   moduleFileExtensions: ["cts", "js", "mjs", "ts", "tsx", "json"],
   moduleNameMapper: {
      "\\.cjs$": "babel-jest", // required because of the regex ReDoS library .cjs files
   },
};
