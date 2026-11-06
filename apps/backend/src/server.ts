import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { buildApp, type App } from "./app";
import { createFlashClient, createInsightModel, createPoolReader, createPriceSource } from "./clients/factory";
import { ConfigError, loadConfig } from "./config";
import { describeConfig } from "./config.summary";
import { migrate, openDb } from "./db/sqlite";
import { createLogger } from "./plugins/logging";
import { systemClock } from "./util/clock";

const LISTEN_HOST = "0.0.0.0";
const REPO_ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));
const EXIT_OK = 0;
const EXIT_FAILURE = 1;

/** Values already in the environment win; loadEnvFile never overrides them. */
function loadDotEnv(): void {
  const file = process.env.ENV_FILE ?? REPO_ENV_FILE;
  if (existsSync(file)) loadEnvFile(file);
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig(process.env);
  const db = openDb(config.sqlitePath);
  migrate(db);
  const app = await buildApp({
    config,
    db,
    clock: systemClock,
    priceSource: createPriceSource(config),
    flash: createFlashClient(config),
    insightModel: createInsightModel(config),
    poolReader: createPoolReader(config),
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    db.close();
    process.exit(EXIT_OK);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  app.log.info({ config: describeConfig(config) }, "backend config");
  await app.listen({ port: config.port, host: LISTEN_HOST });
  // PORT=0 asks the OS for a free port (smoke tests); the bound one is only known after listen.
  app.log.info({ port: boundPort(app, config.port), host: LISTEN_HOST }, "backend listening");
}

/** A TCP listener reports an AddressInfo; a pipe would report a string, which this server never uses. */
function boundPort(app: App, configuredPort: number): number {
  const address = app.server.address();
  return typeof address === "object" && address !== null ? address.port : configuredPort;
}

main().catch((err: unknown) => {
  const log = createLogger({ level: "info" });
  // A config problem is an operator mistake; a stack trace would only hide the one line that matters.
  if (err instanceof ConfigError) log.fatal({ reason: err.message }, "backend failed to start");
  else log.fatal({ err }, "backend failed to start");
  process.exit(EXIT_FAILURE);
});
