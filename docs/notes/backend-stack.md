# Backend stack notes (researched 2026-10-29)

Scope: `apps/backend` (Fastify + zod + pino + better-sqlite3 + viem) and the `scripts/` runner.
Everything here was checked against the npm registry, the official docs, and small probe
scripts run on this machine. Where the docs and the installed code disagreed, the installed
code wins and the discrepancy is called out.

**Machine facts**

- Node `v24.19.0` via nvm, binary is **x86_64** (Intel i7-9750H MacBook Air; `uname -m` = `x86_64`,
  `process.arch` = `x64`). This is *not* an arm64 machine, so native-addon questions below were
  load-tested on `darwin-x64` only.
- pnpm `9.12.0` (root `packageManager`), npm `11.17.0`, TypeScript already resolved to `5.9.3`
  and vitest to `2.1.9` in `pnpm-lock.yaml` via `packages/shared`.
- `tsconfig.base.json` is `module: ESNext`, `moduleResolution: Bundler`, `esModuleInterop: true`,
  `strict`, `isolatedModules`. All snippets below type-check under those settings (also verified
  under `NodeNext`).

---

## 1. Pinned dependencies

Use these exact caret ranges in `apps/backend/package.json`. "Latest" is what npm reported on
2026-10-29; some latest majors are deliberately *not* used, see the note column.

### `dependencies`

| Package | Pin | Latest on npm | Why this pin |
| --- | --- | --- | --- |
| `fastify` | `^5.12.7` | 5.12.7 (`next` = 6.0.0-alpha.5) | Current 5.x. Node >= 20. |
| `@fastify/cors` | `^11.3.1` | 11.3.1 | README table: `^11.x` and `^10.x` are the Fastify 5 lines. |
| `@fastify/rate-limit` | `^11.2.1` | 11.2.1 | Fastify 5 line (fastify-plugin ^6). Verified with `inject({ remoteAddress })`. |
| `pino` | `^9.14.0` | 10.4.0 | fastify 5.12.7 itself declares `pino: "^9.14.0 \|\| ^10.1.0"`; pnpm dedupes to **one** copy of 9.14.0 when we pin 9.14. pino 10.0.0's only breaking change is dropping Node 18, so moving to `^10.1.0` later is safe but unnecessary. |
| `better-sqlite3` | `^13.0.3` | 13.0.3 | First N-API line; prebuilds ship inside the tarball (see section 6). `engines.node >= 22`. |
| `viem` | `^2.57.13` | 2.57.13 (`next` = 3.0.0-next.14) | Stay on 2.x; v3 is pre-release. Peer `typescript >= 5.0.4`. |
| `zod` | `^3.25.76` | 4.6.7 | Must match `packages/shared` (`^3.23.8` -> 3.25.76 in the lock). Do **not** mix zod 3 and 4 in one schema graph. |
| `openai` | `^7.45.1` | 7.45.1 | Version only; SDK API was *not* researched here (T-B05). |

### `devDependencies`

| Package | Pin | Latest on npm | Why this pin |
| --- | --- | --- | --- |
| `typescript` | `^5.9.3` | **7.0.2** | 7.x is the new Go-based compiler. `packages/shared` already resolves 5.9.3; keep the whole workspace on 5.9.x. |
| `vitest` | `^2.1.9` | 5.0.5 | Plan says 2.1.x and `packages/shared` locks 2.1.9. Engines `^18 \|\| >=20`, uses vite 5.4.21. |
| `@vitest/coverage-v8` | `^2.1.9` | 5.0.5 | Peer is `vitest: 2.1.9` exactly, so it must be the same patch as vitest. |
| `tsx` | `^4.23.15` | 4.23.15 | Bundles esbuild ~0.28; vitest brings esbuild 0.21.5 (two esbuild copies is normal). |
| `@types/node` | `^24.19.2` | 26.6.6 | 24.x line matches Node 24.19.x; has `process.loadEnvFile` typed. Vitest 2.1.9 peer accepts it. |
| `@types/better-sqlite3` | `^9.6.0` | 9.6.0 | Only 9.x line after 7.6.13. Uses `export =`, so default import needs `esModuleInterop` (already on). Lacks types for `db.explain()` / `stmt.toString()` added in better-sqlite3 13. |
| `pino-pretty` | `^13.2.0` | 13.2.0 | Dev only; wire via `transport` in dev, never in tests. |

Do **not** add: `dotenv` (use `process.loadEnvFile`), `prebuild-install` (better-sqlite3 13 dropped it),
`node-fetch` (Node 24 has global `fetch`).

Verified install (pnpm, scratch project): `pnpm ls --depth 0` shows exactly one `pino@9.14.0`,
one `vite@5.4.21`, `esbuild@0.21.5` + `esbuild@0.28.2`. No `node-gyp` build ran.

---

## 2. Node 24 facts

- `process.loadEnvFile(path?)` exists (`typeof === 'function'`). Docs history: added v21.7.0 / v20.12.0,
  **"no longer experimental" since v24.10.0**. Default path `'./.env'`.
- Verified behaviour: **throws `ENOENT`** when the file is missing; **does not override** variables
  already set in the environment (shell `FOO=preset` stayed `preset`); handles comments and quoted
  values. `util.parseEnv(string)` also exists.
- CLI flags `--env-file=` and `--env-file-if-exists=` both exist (the latter prints
  `./x not found. Continuing without it.` and carries on).
- Globals available: `fetch`, `Response`, `AbortSignal.timeout`, `structuredClone`.
- `--experimental-strip-types` exists but it does **not** resolve `./local.js` -> `local.ts`, nor
  transform `.ts` entry points in symlinked workspace packages (`ERR_MODULE_NOT_FOUND`). Use tsx.

```ts
// apps/backend/src/env.ts
import { loadEnvFile } from 'node:process';
import { z } from 'zod';

try { loadEnvFile(process.env.ENV_FILE ?? '.env'); } catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; // missing file is fine (CI, prod)
}
export const env = z.object({
  PORT: z.coerce.number().int().default(8787),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173,https://x.com'),
  SQLITE_PATH: z.string().default('./predictx.sqlite'),
  POOL_RPC_URL: z.string().url().default('https://sepolia.base.org'),
}).parse(process.env);
```

---

## 3. Fastify 5.12.7

### Server options that matter

- **`loggerInstance`** is the only way to pass a pino instance. `Fastify({ logger: pino() })` throws
  `FST_ERR_LOG_INVALID_LOGGER_CONFIG: logger options only accepts a configuration object` (verified).
  `logger: { level, redact, stream }` (object form) still works and `stream` can be a capture object.
- **`trustProxy`**: `false` (default) ignores `X-Forwarded-*`; `request.ip` is the socket address.
  `true` / CIDR string / array / `(address, hop) => boolean`. A bare hop-count number is **not**
  supported in 5.12 ("Hop-count-only trust is disabled"). With `trustProxy: true` and
  `x-forwarded-for: 198.51.100.7, 10.0.0.1` from socket `10.0.0.1`, verified:
  `request.ip === '198.51.100.7'`, `request.ips === ['10.0.0.1','10.0.0.1','198.51.100.7']`
  (socket first, then XFF right-to-left), `request.host` comes from `x-forwarded-host`.
- `genReqId: (rawReq) => string` and `requestIdHeader: 'x-request-id'` (default `false`). When the
  header is present it is used verbatim as `request.id` and `genReqId` is skipped (verified).
- `disableRequestLogging` is deprecated in favour of `logController` (removal planned for v6).
  It still works as a boolean today.
- `bodyLimit` (default 1 MiB), `onProtoPoisoning: 'error'` default (secure-json-parse).

### Error handling

- `app.setErrorHandler((err, request, reply) => ...)`: called for errors thrown/returned from
  routes and hooks. If `err.statusCode < 400` Fastify sets it to 500 **before** the handler.
  Custom handler must set status itself (`reply.status(...)`). **Not called for 404s.**
- `app.setNotFoundHandler((request, reply) => ...)`: also used for a known path with an unsupported
  method (`POST /ip` on a GET-only route -> 404 handler, **not 405**, verified). Inside it
  `request.is404 === true` and `request.routeOptions.config` is `{}`.
- **Order gotcha (verified)**: call `setErrorHandler` / `setNotFoundHandler` **before**
  `await app.register(cors)`. Routes finalised earlier (the CORS wildcard `OPTIONS` route) capture
  the error handler in force at that time; registering cors first left preflight errors on the
  default `{ statusCode, error, message }` shape while normal routes used the custom one.
- Error codes you will see in the handler (from `lib/errors.js`, all `err.name === 'FastifyError'`):

| `err.code` | `err.statusCode` | When |
| --- | --- | --- |
| `FST_ERR_CTP_INVALID_JSON_BODY` | 400 | `content-type: application/json` and body is not valid JSON (`{bad json`). Message: `Body is not valid JSON but content-type is set to 'application/json'`. |
| `FST_ERR_CTP_EMPTY_JSON_BODY` | 400 | JSON content-type with zero-length body. |
| `FST_ERR_CTP_INVALID_MEDIA_TYPE` | 415 | no parser for the content-type. |
| `FST_ERR_CTP_BODY_TOO_LARGE` | 413 | over `bodyLimit` (class `RangeError`). |
| `FST_ERR_CTP_INVALID_CONTENT_LENGTH` | 400 | body size != `Content-Length`. |
| `FST_ERR_VALIDATION` | 400 | JSON-schema validation; `err.validation` is the Ajv error array, `err.validationContext` is `'body' \| 'params' \| 'querystring' \| 'headers'`. |
| `FST_ERR_NOT_FOUND` | 404 | only if you call the default handler yourself. |
| *(none)* | 429 | `@fastify/rate-limit` errors have **no `code`**; branch on `statusCode === 429`. |

  Note: there is no `FST_ERR_CTP_INVALID_JSON`; the real code ends in `_BODY`. The Errors doc page
  has the two JSON descriptions swapped; the source (`lib/content-type-parser.js` `defaultJsonParser`)
  is authoritative and matches the table above.
- Since we validate with zod in handlers/preHandlers (shared schemas), a `ZodError` thrown there
  reaches the same error handler with no `statusCode`; map it to 400 `BAD_REQUEST` explicitly.

```ts
// apps/backend/src/app.ts
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Logger } from 'pino';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { ZodError } from 'zod';

export type App = FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>; // see TS gotcha

export async function buildApp(opts: { logger: Logger; allowedOrigins: string[]; trustProxy?: boolean }) {
  const app = Fastify({ loggerInstance: opts.logger, trustProxy: opts.trustProxy ?? false, requestIdHeader: 'x-request-id' });

  // 1) handlers FIRST so plugin-registered routes (CORS OPTIONS) use them
  app.setErrorHandler((err: FastifyError | ZodError, req, reply) => {
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid request', details: err.issues } });
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    const code =
      status === 429 ? 'RATE_LIMITED'
      : err.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || err.code === 'FST_ERR_VALIDATION' ? 'BAD_REQUEST'
      : status >= 500 ? 'INTERNAL' : (err.code ?? 'ERROR');
    if (status >= 500) req.log.error({ err }, 'unhandled');
    return reply.status(status).send({ error: { code, message: status >= 500 ? 'Internal error' : err.message } });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.url}` } }));

  // 2) plugins
  await app.register(cors, { origin: opts.allowedOrigins, methods: ['GET', 'POST', 'OPTIONS'] });
  await app.register(rateLimit, { global: false }); // enable per route via config.rateLimit

  // 3) routes; per-route metadata lives in `config`
  app.get('/health', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => ({
    ok: true, ts: Date.now(), limited: (req.routeOptions.config as { rateLimit?: unknown }).rateLimit !== undefined,
  }));
  return app;
}
```

### Route `config`, hooks

- Route option `config: object` = "object used to store custom configuration". Read it with
  `request.routeOptions.config` (or `reply.routeOptions.config`). Fastify adds `url` and `method`
  into it (verified: `{ rateLimit: {...}, url: '/ip', method: 'GET' }`). v5 removed
  `request.context`, `request.routeConfig`, `request.routeSchema`, `request.routerPath`
  (all -> `request.routeOptions.*`).
- Hook order: `onRequest -> preParsing -> preValidation -> preHandler -> preSerialization -> onError
  -> onSend -> onResponse` (+ `onTimeout`, `onRequestAbort`). Per-route hooks run last in their
  category and accept arrays. Errors thrown in hooks go to the error handler.
- `onSend` runs on the CORS preflight too (verified `x-probe` header on the 204).

```ts
app.addHook('preHandler', async (req) => { req.log.debug({ body: req.body }, 'parsed body'); }); // body is only available from preValidation on
app.addHook('onSend', async (req, reply, payload) => { reply.header('x-request-id', req.id); return payload; }); // return string | Buffer | stream | null
app.post('/flash/quote', { preHandler: [checkSize], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, handler);
```

### `app.inject()` (light-my-request 6)

Options: `method` (default GET), `url`/`path`, `headers` (array value = repeated header), `payload`/`body`
(object -> `JSON.stringify` + `content-type: application/json`; string sent as-is), `query` (object or
string; **merged with** the query in `url`, verified), `cookies`, `authority` (Host, default `localhost`),
**`remoteAddress` (string, default `'127.0.0.1'`)**, `simulate`, `signal`, `validate`.
Response: `statusCode`, `statusMessage`, `headers`, `body`/`payload` (string), `rawPayload` (Buffer),
`json()`, `cookies`, `trailers`. `inject` waits for `ready()` itself; call `app.close()` in teardown.

```ts
const res = await app.inject({ method: 'POST', url: '/flash/quote', remoteAddress: '203.0.113.9', headers: { origin: 'http://localhost:5173' }, payload: { symbol: 'ETH' } });
expect(res.statusCode).toBe(200); expect(res.json()).toMatchObject({ ... });
// malformed JSON: send a *string* payload with the JSON content-type
const bad = await app.inject({ method: 'POST', url: '/flash/quote', headers: { 'content-type': 'application/json' }, payload: '{bad json' });
expect(bad.statusCode).toBe(400); // err.code === 'FST_ERR_CTP_INVALID_JSON_BODY'
```

### Other v5 migration facts

Node >= 20; `jsonShortHand` removed (schemas need full JSON Schema with `type`);
`useSemicolonDelimiter` default `false`; `reply.getResponseTime()` -> `reply.elapsedTime`;
`decorateRequest('x', {})` with an object/array value is prohibited (use `getter` or `null` + onRequest).
`fastify.hasRoute()` wants the registered pattern. Logging docs: serializers must never throw; `req`
serializer runs before the body is parsed (default `req` log has `method,url,host,remoteAddress,remotePort`, **no headers**).

---

## 4. `@fastify/cors` 11.3.1

- Registers an `onRequest` hook plus a wildcard `OPTIONS` route. Defaults: `methods: 'GET,HEAD,POST'`,
  `optionsSuccessStatus: 204`, `preflight: true`, `strictPreflight: true`, `hideOptionsRoute: true`,
  `hook: 'onRequest'`. `credentials: true` adds `Access-Control-Allow-Credentials`.
- `origin` accepts `boolean | string | RegExp | (string|RegExp)[] | (origin, cb) => void` (also
  async/Promise-returning). The function gets the raw `Origin` header (`undefined` for non-browser
  callers) and must call `cb(err | null, allowed)` where `allowed` is `boolean | string | RegExp | array`.
- Verified outcomes:
  - allowed -> `access-control-allow-origin: <origin>` + `vary: Origin` (Vary is always added for
    non-static origin options).
  - `cb(null, false)` -> request **continues** (200) with no ACAO header; the browser blocks it.
  - `cb(new Error('...'))` -> goes to the error handler; default status 500, so set
    `err.statusCode = 403` yourself (verified 403 with a custom body).
  - Preflight `OPTIONS` with `Origin` + `Access-Control-Request-Method` -> **204**, headers
    `access-control-allow-origin`, `access-control-allow-methods: GET, POST, OPTIONS`,
    `access-control-allow-headers` reflected from `Access-Control-Request-Headers` unless `allowedHeaders` set.
  - Preflight missing `Access-Control-Request-Method` -> **400** `Invalid Preflight Request` (`strictPreflight`).
- Per-route override: `config: { cors: false }` or `config: { cors: { origin: '*' } }`.
  Async per-request options: `{ delegator: (req, cb) => cb(null, corsOptions) }`.

```ts
const allowed = new Set(env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean));
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || allowed.has(origin)) return cb(null, true); // curl / same-origin / allowlisted
    const err = Object.assign(new Error('Origin not allowed'), { statusCode: 403, code: 'FORBIDDEN_ORIGIN' });
    cb(err, false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  maxAge: 600,
});
```

`@fastify/rate-limit` 11.2.1 (bonus, needed by T-B01): keys on `request.ip` by default, so
`inject({ remoteAddress })` is how you test per-IP limits. Verified: `max: 2` -> third call 429 with
`x-ratelimit-limit/remaining/reset` and `retry-after` headers; a different `remoteAddress` is a fresh
bucket; `global: false` leaves routes without `config.rateLimit` unlimited (no headers).

---

## 5. pino 9.14.0

- `pino([options], [destination])`. `destination` can be a fd/path, `pino.destination()`, SonicBoom,
  or any object implementing `DestinationStream { write(msg: string): void }` (typed in `pino.d.ts`).
  `transport` and a `destination` argument **cannot** be combined (throws).
- `redact: string[] | { paths: string[]; censor?: string | ((value, path) => any); remove?: boolean }`.
  Path syntax: `a.b.c`, `a["b-c"].d`, `["a-b"].c`, `a.b.*`, `a[*].b`; case sensitive; `*` wildcards
  cost more (only use for a few keys). Paths must be static (fast-redact evaluates them in a VM).
  Verified `['apiKey', '*.apiKey']` redacted both the top-level and one-level-nested key.
- `base: null` drops `pid`/`hostname` (handy for test snapshots). `level: 'silent'` mutes.
- Redacting `req.headers.authorization` only matters if you add a custom `req` serializer that logs
  headers; Fastify's default `req` serializer does not include headers.

```ts
// apps/backend/src/logger.ts
import pino, { type DestinationStream, type Logger } from 'pino';
export const REDACT = ['req.headers.authorization', 'req.headers["x-api-key"]', 'apiKey', '*.apiKey', 'signature', '*.signature'];
export function createLogger(level: string, dest?: DestinationStream): Logger {
  return pino({ level, base: null, redact: { paths: REDACT, censor: '[redacted]' } }, dest ?? pino.destination(1));
}

// test helper: capture JSON lines
export function captureLogger(level = 'info') {
  const lines: Record<string, unknown>[] = [];
  const dest: DestinationStream = { write: (msg) => { lines.push(JSON.parse(msg)); } };
  return { logger: createLogger(level, dest), lines };
}
// usage: const { logger, lines } = captureLogger(); const app = await buildApp({ logger, ... });
//        expect(lines.find(l => l.msg === 'request completed')).toMatchObject({ res: { statusCode: 200 } });
```

Dev pretty output (never in tests): `pino({ transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' } } })`.

---

## 6. better-sqlite3 13.0.3

- **Prebuilt binaries ship inside the npm tarball**: `prebuilds/{darwin-arm64,darwin-x64,linux-arm64,linux-x64,linuxmusl-arm64,linuxmusl-x64,win32-arm64,win32-x64}.node`,
  loaded by `lib/<platform>-<arch>.js`. v13.0.0 is the first N-API build ("binaries should work across
  Node/Electron versions"); `prebuild-install` was **removed**, so nothing is downloaded at install time
  and there is no `node-v137-...` asset to look up. `engines.node >= 22`, dep `node-addon-api ^8`.
- Verified on this machine: `pnpm add better-sqlite3@13.0.3` on Node 24.19.0 / darwin-x64 completed
  with no `build/` directory (prebuilt used, no node-gyp). `darwin-arm64.node` is present in the same
  tarball but was not load-tested here (no arm64 host).
- ESM: `import Database from 'better-sqlite3'` works at runtime (module keys: `default`, `SqliteError`,
  `module.exports`). Types are `export = Database` so the default import type-checks only with
  `esModuleInterop` (on in `tsconfig.base.json`). Named `import { SqliteError }` is not typed; use `Database.SqliteError`.
- API (unchanged from 11/12): `new Database(path, { readonly, fileMustExist, timeout: 5000, verbose, nativeBinding })`,
  `':memory:'` for in-memory, `db.pragma('journal_mode = WAL')`, `db.pragma('user_version', { simple: true })`
  returns a scalar, `db.exec(multiStatementSql)`, `db.prepare(sql)` -> `stmt.run()` returns
  `{ changes, lastInsertRowid }`, `.get()` -> row | undefined, `.all()`, `.iterate()`, `.pluck()`, `.raw()`,
  `.expand()`, `.safeIntegers()`, `db.transaction(fn)` (+ `.deferred/.immediate/.exclusive`), `db.close()`.
  New in 13: `db.explain()`, `stmt.toString()` (not in `@types/better-sqlite3@9.6.0`).
- Binding rules (verified): only `number | string | bigint | Buffer | null` bind. `true`/`Date` throw
  `TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and null`; `undefined` binds as NULL.
  Named params `@id`, `:id`, `$id` via one object; positional `?` via args or array. Mixing is allowed.
  Integers > 2^53 silently round unless `.safeIntegers(true)` (then BigInt).
- Errors: `SqliteError` with `.code` such as `SQLITE_CONSTRAINT_PRIMARYKEY`, `SQLITE_CONSTRAINT_NOTNULL`,
  `SQLITE_ERROR` (bad SQL at `prepare`), `SQLITE_BUSY` after `timeout`.
- Works inside vitest in both `forks` (default) and `threads` pools (verified).

```ts
// apps/backend/src/db.ts
import Database from 'better-sqlite3';
import type { Database as Db, Statement } from 'better-sqlite3';

export function openDb(path = ':memory:'): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS quotes   (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders   (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL REFERENCES quotes(id), status TEXT NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS insights (key TEXT PRIMARY KEY, created_at INTEGER NOT NULL, payload TEXT NOT NULL);
  `);
  return db;
}

type QuoteRow = { id: string; created_at: number; expires_at: number; payload: string };
export function quoteRepo(db: Db) {
  const insert: Statement<{ id: string; createdAt: number; expiresAt: number; payload: string }> =
    db.prepare('INSERT INTO quotes (id, created_at, expires_at, payload) VALUES (@id, @createdAt, @expiresAt, @payload)');
  const byId: Statement<[string], QuoteRow> = db.prepare('SELECT * FROM quotes WHERE id = ?');
  return {
    put: (q: { id: string; createdAt: number; expiresAt: number; payload: unknown }) =>
      insert.run({ ...q, payload: JSON.stringify(q.payload) }), // objects/booleans/Dates must be stringified or coerced first
    get: (id: string) => byId.get(id),
  };
}
```

---

## 7. viem 2.57.13

- `createPublicClient({ chain, transport: http(url?, opts?), batch?: { multicall: boolean | { wait: 0, batchSize: 1024 } }, pollingInterval?, cacheTime? })`.
  `http` options: `url` (default `chain.rpcUrls.default.http[0]`), `batch` (JSON-RPC batching, default false),
  `fetchOptions`, `timeout: 10_000`, `retryCount: 3`, `retryDelay: 150`, `onFetchRequest/onFetchResponse`.
- `readContract({ address, abi, functionName, args?, blockNumber?, blockTag?, account?, stateOverride? })`;
  types for `args`/return are inferred when the ABI is `as const` or built with `parseAbi([...])`.
- `multicall({ contracts: [{ address, abi, functionName, args? }, ...], allowFailure = true, batchSize?, blockNumber?, multicallAddress? })`.
  **Runtime result shape (verified) is `{ status: 'success', result }` | `{ status: 'failure', error }`**;
  the docs page text says `data`/`'reverted'`, which is wrong for 2.57.13. With `allowFailure: false`
  the return is a bare results array and any revert throws. Uses `chain.contracts.multicall3.address`.
- `viem/chains`: `baseSepolia` = `{ id: 84532, name: 'Base Sepolia', rpcUrls.default.http: ['https://sepolia.base.org'], contracts.multicall3: { address: '0xca11bde05977b3631167028862be2a173976ca11', blockCreated: 1059647 }, testnet: true, blockExplorers.default.url: 'https://sepolia.basescan.org' }`.
  `base` = id 8453, `https://mainnet.base.org`, same multicall3 address.
- Live check at research time: `getChainId()` -> 84532, `readContract(multicall3.getBlockNumber)` ->
  51548491n, a 3-call `multicall` (one deliberately bad address) returned two `success` and one
  `failure` (`ContractFunctionExecutionError`) in ~1 s over the public RPC.
- `viem/accounts`: `privateKeyToAccount(hex)` -> `{ address, type: 'local', source: 'privateKey', sign, signAuthorization, signMessage, signTransaction, signTypedData }`;
  `generatePrivateKey()`. `account.signTypedData({ domain, types, primaryType, message })` returns a 65-byte
  hex sig; `verifyTypedData({ address, ..., signature })` for tests. **Typed data parsed from a JSON string
  (with an `EIP712Domain` entry in `types` and uint values as decimal strings, i.e. the
  `eth_signTypedData_v4` shape Flash will send) signs to the identical signature** (verified), so the
  backend can pass Flash's typed-data strings through untouched and `scripts/gate0-flash.ts` can sign them locally.

```ts
// apps/backend/src/chain.ts
import { createPublicClient, http, parseAbi } from 'viem';
import { baseSepolia } from 'viem/chains';
export const poolAbi = parseAbi(['function getPool(uint256 id) view returns (uint256 strike, uint64 resolveTime, uint8 status, uint256 yesTotal, uint256 noTotal)']);
export const client = createPublicClient({ chain: baseSepolia, transport: http(env.POOL_RPC_URL, { timeout: 10_000, retryCount: 2 }), batch: { multicall: true } });
export const readPools = (address: `0x${string}`, ids: bigint[]) =>
  client.multicall({ contracts: ids.map((id) => ({ address, abi: poolAbi, functionName: 'getPool', args: [id] })) }); // r.status === 'success' ? r.result : r.error

// scripts/gate0-flash.ts (signing a Flash typed-data string)
import { privateKeyToAccount } from 'viem/accounts';
const account = privateKeyToAccount(process.env.GATE0_PRIVATE_KEY as `0x${string}`);
const typed = JSON.parse(quote.steps.orderTypedData); // { domain, types, primaryType, message } as returned by Flash
const signature = await account.signTypedData(typed);
```

---

## 8. vitest 2.1.9 (+ `@vitest/coverage-v8` 2.1.9)

- Config in `vitest.config.ts` via `import { defineConfig, mergeConfig } from 'vitest/config'`; options
  live under `test`. Defaults: `environment: 'node'`, `pool: 'forks'`, `testTimeout: 5000`,
  `include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)']`, `coverage.provider: 'v8'`, `coverage.all: true`,
  `coverage.reporter: ['text','html','clover','json']`, `coverage.reportsDirectory: './coverage'`.
- `setupFiles: string | string[]` runs before **each test file** in the test context (so `process.env`
  set there is visible to tests). `globalSetup` runs once in a separate scope (`setup`/`teardown` exports).
- Fake timers: `vi.useFakeTimers()` fakes `setTimeout, clearTimeout, setImmediate, clearImmediate,
  setInterval, clearInterval, Date` (config `fakeTimers.toFake` default); **`process.nextTick` is not
  faked** (opt in with `toFake: ['nextTick']`, which hangs under `--pool=forks`). `vi.setSystemTime(d)`
  works **without** fake timers too (then it only mocks `Date`). `vi.advanceTimersByTime(ms)`,
  `vi.advanceTimersByTimeAsync(ms)`, `vi.runAllTimers()` (`loopLimit` 10 000), `vi.useRealTimers()`.
  **Verified: `app.inject()` resolves normally while fake timers are active** (so quote-expiry /
  cache-TTL tests can freeze the clock around a request).
- `vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))`
  replaces the global; `vi.unstubAllGlobals()` or `test.unstubGlobals: true` restores before each test
  (verified). `vi.stubEnv('X','1')` / `unstubEnvs` likewise. `vi.mock` is hoisted; use `vi.hoisted` for
  factory variables.
- Coverage thresholds: `coverage.thresholds: { lines, functions, branches, statements, perFile?, autoUpdate?, 100? , '**/glob.ts': {...} }`.
  A missed threshold prints `ERROR: Coverage for functions (66.66%) does not meet global threshold (100%)`
  and **exits 1** even when all tests pass (verified; `perFile` names the file). CLI overrides:
  `--coverage.thresholds.lines=90`. `coverage.include` should be `['src/**/*.ts']` so `all: true`
  counts untested files.
- Multiple config files: `vitest run --config vitest.integration.config.ts` with
  `mergeConfig(base, defineConfig({ test: { include: [...], env: { INTEGRATION: '1' }, testTimeout: 30_000, coverage: { enabled: false } } }))`
  (verified). The alternative is a root `vitest.workspace.ts` exporting `defineWorkspace([...])` with
  uniquely named projects and `--project <name>`; `coverage` and `reporters` are root-only there.
- Run vitest **from the package directory** (`apps/backend`). `pnpm exec` resets cwd to the nearest
  `package.json`, so a config in a subfolder is silently ignored and default globs run everything.

```ts
// apps/backend/vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    unstubGlobals: true, unstubEnvs: true, restoreMocks: true,
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/server.ts'], reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 85, functions: 85, branches: 75, statements: 85 } },
  },
});
// apps/backend/vitest.integration.config.ts
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';
export default mergeConfig(base, defineConfig({ test: { include: ['test/integration/**/*.int.test.ts'], testTimeout: 30_000, coverage: { enabled: false } } }));
```

```ts
// test example: frozen clock + stubbed fetch + inject
it('expires a quote after expiresAt', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ethereum: { usd: 2500 } }), { status: 200 })));
  const quote = (await app.inject({ method: 'POST', url: '/flash/quote', payload: body })).json();
  vi.setSystemTime(new Date(quote.expiresAt + 1));
  const res = await app.inject({ method: 'POST', url: '/flash/order', payload: { quoteId: quote.id, signatures } });
  expect(res.statusCode).toBe(410); expect(res.json().error.code).toBe('QUOTE_EXPIRED');
});
```

---

## 9. tsx 4.23.15

- `tsx ./src/server.ts`, `tsx watch ./src/server.ts` (`--clear-screen=false`, `--ignore`, `--include`),
  `node --import tsx ./file.ts` (ESM + CJS), `node --import tsx/esm`, `node --require tsx/cjs`,
  `NODE_OPTIONS='--import tsx'`. Node flags pass through: **`tsx --env-file=.env ./script.ts` works**
  (verified; `--env-file-if-exists` too). `--tsconfig ./path.json` (sets `TSX_TSCONFIG_PATH` internally);
  default is the nearest `tsconfig.json` from cwd. tsx does **not** type-check; keep `tsc --noEmit` as `typecheck`.
- Verified with a symlinked workspace package whose `package.json` has `"main": "src/index.ts"` (same
  shape as `@predictx/shared`): tsx transforms the `.ts` entry through the symlink, resolves
  `import './local.js'` to `local.ts`, and accepts `import './local.ts'`. ESM is chosen from
  `"type": "module"`. Only esbuild-supported `compilerOptions` apply (`jsx*`, `paths`, target);
  `emitDecoratorMetadata` is unsupported.

```jsonc
// apps/backend/package.json (scripts)
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch --clear-screen=false --env-file-if-exists=../../.env src/server.ts",
    "start": "node --import tsx src/server.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  }
}
```

---

## 10. Gotchas (consolidated)

1. **ESM + better-sqlite3**: `import Database from 'better-sqlite3'` (default import). Types are
   `export =`; keep `esModuleInterop: true`. Use `Database.SqliteError` for `instanceof`. Never bind
   booleans/Dates/objects; coerce to `0|1`, epoch ms, `JSON.stringify`.
2. **better-sqlite3 13 prebuilds**: in-tarball for darwin x64 and arm64, no `prebuild-install`, no
   network at install. If a build ever starts, something is off (wrong Node < 22 or a Node
   `--experimental` ABI); do not add `npm rebuild` steps.
3. **Fastify `logger` vs `loggerInstance`**: a pino instance **must** go in `loggerInstance`; passing
   it as `logger` throws `FST_ERR_LOG_INVALID_LOGGER_CONFIG`.
4. **TypeScript `FastifyInstance` + pino**: with `loggerInstance`, `Fastify()` returns
   `FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>`. Annotating a builder as the bare
   `FastifyInstance` fails with "Property 'msgPrefix' is missing in type 'FastifyBaseLogger'". Either
   `export type App = Awaited<ReturnType<typeof buildApp>>` or the explicit 4-generic form above.
5. **Register error/404 handlers before `register(cors)`**, otherwise the CORS `OPTIONS` route keeps the
   default error shape.
6. **`inject` + `remoteAddress`**: `request.ip` is exactly the injected `remoteAddress` (default
   `127.0.0.1`) when `trustProxy` is off; `x-forwarded-for` is only honoured with `trustProxy: true`.
   Use distinct `remoteAddress` values to test rate limits; `@fastify/rate-limit` keys on `request.ip`.
7. **Malformed JSON**: the code is `FST_ERR_CTP_INVALID_JSON_BODY` (400), empty body is
   `FST_ERR_CTP_EMPTY_JSON_BODY` (400). To trigger it in tests send a **string** payload with
   `content-type: application/json` (object payloads are serialised for you).
8. **pino test capture**: pass `{ write(msg) { lines.push(JSON.parse(msg)) } }` as the second
   `pino()` argument; never combine with `transport`. Set `base: null` for stable output. Header
   redaction only applies if you add a custom `req` serializer.
9. **viem multicall status strings** are `'success' | 'failure'` at runtime (docs text says
   `'reverted'`); branch on `status === 'success'`.
10. **vitest fake timers**: `setImmediate` is faked by default but `inject` still completes; do not
    fake `nextTick` under the default `forks` pool. `vi.setSystemTime` alone is enough for
    `Date.now()`-based expiry checks.
11. **Coverage threshold failures exit 1** with all tests green; keep thresholds in the config so TDD
    runs fail loudly in CI.
12. **`process.loadEnvFile`** throws `ENOENT` when the file is missing and never overrides existing
    env; wrap it and ignore `ENOENT`, or use `--env-file-if-exists` on the CLI.
13. **Do not use Node's native `--experimental-strip-types`** for the backend; it cannot map
    `./x.js` -> `x.ts` or load `@predictx/shared`'s `.ts` entry. tsx handles both.
14. **Versions**: npm `latest` is TypeScript 7, vitest 5, zod 4, pino 10, @types/node 26. The pins in
    section 1 deliberately stay on TS 5.9 / vitest 2.1 / zod 3 / pino 9 / @types/node 24 to match
    `packages/shared` and the plan; update them together, not one at a time.

---

## Sources

- npm registry (`npm view ...`, 2026-10-29) for every version and `engines`/`peerDependencies`.
- Fastify: https://fastify.dev/docs/latest/Reference/Server/ , /Reference/Logging/ , /Reference/Errors/ ,
  /Reference/Hooks/ , /Reference/Routes/ , /Reference/Request/ , /Guides/Testing/ , /Guides/Migration-Guide-V5/ ,
  and `fastify@5.12.7/lib/errors.js`, `lib/content-type-parser.js` (installed copy).
- light-my-request README (inject options / response), https://github.com/fastify/light-my-request
- @fastify/cors README, https://github.com/fastify/fastify-cors (+ installed `index.js` for defaults)
- pino docs: https://github.com/pinojs/pino/blob/main/docs/api.md , /docs/redaction.md ,
  https://github.com/pinojs/pino/releases/tag/v10.0.0
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3/releases , /blob/master/docs/api.md ,
  tarball `better-sqlite3-13.0.3.tgz` contents.
- viem: https://viem.sh/docs/clients/public , /docs/clients/transports/http , /docs/contract/readContract ,
  /docs/contract/multicall , /docs/accounts/local/privateKeyToAccount , /docs/accounts/local/signTypedData ,
  `src/chains/definitions/baseSepolia.ts`.
- vitest v2 docs: https://v2.vitest.dev/api/vi.html , https://v2.vitest.dev/config/ , https://v2.vitest.dev/guide/workspace
- tsx docs source: https://github.com/privatenumber/tsx/tree/master/docs (tsx.is returned a TLS error from this machine).
- Node: https://nodejs.org/docs/latest-v24.x/api/process.html#processloadenvfilepath and `node --help`.
- Probe scripts and a full scratch install live under
  `<tmp>/probe` (not part of the repo).
