import { ApiError, ErrorCode } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { AppError, unsupportedToken, upstreamError, type ErrorCodeName } from "../src/errors";
import { buildTestApp } from "./helpers/build";
import { LogCapture } from "./helpers/logCapture";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

describe("B01-09 AppError from a route", () => {
  it("renders UNSUPPORTED_TOKEN as HTTP 400 in ApiError shape", async () => {
    built = await buildTestApp({
      extraRoutes: (app) => {
        app.get("/boom-unsupported", async () => {
          throw unsupportedToken("DOGE is not supported");
        });
      },
    });
    const res = await built.app.inject({ method: "GET", url: "/api/v1/boom-unsupported" });
    expect(res.statusCode).toBe(400);
    const parsed = ApiError.parse(res.json());
    expect(parsed.error.code).toBe("UNSUPPORTED_TOKEN");
    expect(parsed.error.message).toBe("DOGE is not supported");
    expect(unsupportedToken("x")).toBeInstanceOf(AppError);
  });
});

describe("B01-10 every ErrorCode maps to its contract status", () => {
  const expectedStatus: Record<ErrorCodeName, number> = {
    BAD_REQUEST: 400,
    UNSUPPORTED_TOKEN: 400,
    NOT_FOUND: 404,
    QUOTE_EXPIRED: 409,
    RATE_LIMITED: 429,
    FLASH_ERROR: 502,
    LLM_UNAVAILABLE: 503,
    INTERNAL: 500,
  };

  it.each(ErrorCode.options)("%s", async (code) => {
    built = await buildTestApp({
      extraRoutes: (app) => {
        app.get("/boom", async () => {
          throw new AppError(code, `message for ${code}`);
        });
      },
    });
    const res = await built.app.inject({ method: "GET", url: "/api/v1/boom" });
    expect(res.statusCode).toBe(expectedStatus[code]);
    const parsed = ApiError.parse(res.json());
    expect(parsed.error.code).toBe(code);
    expect(parsed.error.message).toBe(`message for ${code}`);
  });
});

describe("B01-11 unexpected errors", () => {
  it("yields 500 INTERNAL with a generic message that leaks nothing", async () => {
    built = await buildTestApp({
      extraRoutes: (app) => {
        app.get("/boom-unknown", async () => {
          throw new Error("secret internal detail at /Users/x/stack.ts:12");
        });
      },
    });
    const res = await built.app.inject({ method: "GET", url: "/api/v1/boom-unknown" });
    expect(res.statusCode).toBe(500);
    const parsed = ApiError.parse(res.json());
    expect(parsed.error.code).toBe("INTERNAL");
    expect(parsed.error.message).toBe("Internal error");
    expect(res.body).not.toContain("secret internal detail");
    expect(res.body).not.toContain("stack.ts");
  });
});

describe("B01-12 malformed JSON body", () => {
  it("yields 400 BAD_REQUEST", async () => {
    built = await buildTestApp({
      extraRoutes: (app) => {
        app.post("/echo", async (request) => request.body);
      },
    });
    const res = await built.app.inject({
      method: "POST",
      url: "/api/v1/echo",
      headers: { "content-type": "application/json" },
      payload: "{bad json",
    });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("BAD_REQUEST");
  });
  it("treats an empty JSON body as BAD_REQUEST too", async () => {
    built = await buildTestApp({
      extraRoutes: (app) => {
        app.post("/echo", async (request) => request.body);
      },
    });
    const res = await built.app.inject({
      method: "POST",
      url: "/api/v1/echo",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("BAD_REQUEST");
  });
});

describe("B01-12b a stray ZodError is our bug, not the client's", () => {
  it("yields 500 INTERNAL with the generic message and logs it, since request validation already throws badRequest", async () => {
    const logs = new LogCapture();
    built = await buildTestApp({
      logStream: logs,
      extraRoutes: (app) => {
        app.get("/zod", async () => {
          ApiError.parse({ nope: true });
        });
      },
    });
    const res = await built.app.inject({ method: "GET", url: "/api/v1/zod" });
    expect(res.statusCode).toBe(500);
    expect(ApiError.parse(res.json()).error).toEqual({ code: "INTERNAL", message: "Internal error" });
    expect(logs.entries().find((e) => e.msg === "unhandled error")).toMatchObject({ err: { name: "ZodError" } });
  });
});

describe("B01-09b upstream failures keep code INTERNAL but answer 502 (B02-13, B07-19)", () => {
  it("upstreamError() renders 502 with code INTERNAL and the given message", async () => {
    built = await buildTestApp({
      extraRoutes: (app) => {
        app.get("/boom-upstream", async () => {
          throw upstreamError("price source unavailable");
        });
      },
    });
    const res = await built.app.inject({ method: "GET", url: "/api/v1/boom-upstream" });
    expect(res.statusCode).toBe(502);
    const parsed = ApiError.parse(res.json());
    expect(parsed.error.code).toBe("INTERNAL");
    expect(parsed.error.message).toBe("price source unavailable");
    expect(new AppError("INTERNAL", "x", { status: 502 }).status).toBe(502);
    expect(new AppError("INTERNAL", "x").status).toBe(500);
  });
});
