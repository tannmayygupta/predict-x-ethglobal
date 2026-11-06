import type { FastifyPluginAsync, FastifyTypeProviderDefault } from "fastify";
import type { Server } from "node:http";
import type { Logger } from "pino";
import { buildApp, type App, type AppDeps, type Db } from "../../src/app";
import { loadConfig } from "../../src/config";
import { migrate, openDb } from "../../src/db/sqlite";
import { BASELINE_ENV } from "./env";
import { FakeClock } from "./fakes/clock";
import { NotConfiguredFlash } from "./fakes/flash";
import { FakeInsightModel } from "./fakes/insightModel";
import { FakePoolReader } from "./fakes/poolReader";
import { FakePriceSource } from "./fakes/priceSource";

export interface TestAppOverrides extends Partial<AppDeps> {
  env?: Record<string, string>;
  /** Receives an instance scoped under config.apiPrefix; throwaway test routes go here. */
  extraRoutes?: (app: App) => Promise<void> | void;
}

export interface TestApp {
  app: App;
  db: Db;
  clock: FakeClock;
  deps: AppDeps;
}

/** Every test builds the app this way: baseline env, :memory: sqlite, fakes for every adapter. */
export async function buildTestApp(overrides: TestAppOverrides = {}): Promise<TestApp> {
  const { env, extraRoutes, ...depOverrides } = overrides;
  const config = depOverrides.config ?? loadConfig({ ...BASELINE_ENV, ...env });
  const db = depOverrides.db ?? openDb(config.sqlitePath);
  migrate(db);
  const clock = depOverrides.clock instanceof FakeClock ? depOverrides.clock : new FakeClock();
  const deps: AppDeps = {
    config,
    db,
    clock,
    priceSource: depOverrides.priceSource ?? new FakePriceSource(),
    flash: depOverrides.flash ?? new NotConfiguredFlash(),
    insightModel: depOverrides.insightModel ?? new FakeInsightModel(),
    poolReader: depOverrides.poolReader ?? new FakePoolReader(),
    // Silence by default; logging tests pass their own capture stream.
    logStream: depOverrides.logStream ?? { write: () => undefined },
  };
  const app = await buildApp(deps);
  if (extraRoutes) {
    // Typed explicitly so the scoped instance carries the pino Logger generic (see src/appTypes.ts).
    const plugin: FastifyPluginAsync<Record<never, never>, Server, FastifyTypeProviderDefault, Logger> = async (
      scoped,
    ) => {
      await extraRoutes(scoped);
    };
    await app.register(plugin, { prefix: config.apiPrefix });
  }
  return { app, db, clock, deps };
}
