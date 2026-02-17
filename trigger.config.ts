import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "@trigger.dev/sdk";

for (const envFile of [".env.local", ".env"]) {
  loadDotenv({ path: path.resolve(process.cwd(), envFile), override: false });
}

const projectRef = process.env.TRIGGER_PROJECT_REF || "proj_vjtmmmbsbpcyfsrwcruj";

export default defineConfig({
  project: projectRef,
  dirs: ["./trigger"],
  maxDuration: 3600,
});
