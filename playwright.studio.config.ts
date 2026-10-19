import { makeConfig } from "./playwright.config";
const config = makeConfig();
config.testMatch = "studio.spec.ts";
export default config;
