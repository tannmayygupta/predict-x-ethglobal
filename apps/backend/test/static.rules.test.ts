import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * X-02 and X-05 as tests, so the RULES.md greps run on every `pnpm test` instead of by hand.
 * The patterns are built from fragments so this file never matches itself.
 */

const BACKEND_DIR = fileURLToPath(new URL("..", import.meta.url));
const SRC_DIR = join(BACKEND_DIR, "src");
const CONTRACT_DIR = join(BACKEND_DIR, "test", "contract");

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) return listTsFiles(file);
    return name.endsWith(".ts") ? [file] : [];
  });
}

interface Violation {
  file: string;
  line: number;
  text: string;
}

function findLines(files: string[], pattern: RegExp): Violation[] {
  return files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((text, index) => ({ file: relative(BACKEND_DIR, file), line: index + 1, text: text.trim() }))
      .filter((entry) => pattern.test(entry.text)),
  );
}

const CONSOLE_LOG = new RegExp(["console", "\\.log\\("].join(""));
const ANY_TYPE = new RegExp([":\\s*any\\b", "\\bas any\\b", "<any>"].join("|"));
const TS_IGNORE = new RegExp(["@ts-", "ignore"].join(""));
/** `x!` before member access, punctuation, whitespace, end of line or `??`; `!=` and `!==` are not followed by any of these. */
const NON_NULL_ASSERTION = new RegExp(["[\\w)\\]]", "!", "(?=[.[;,)]|\\s|$|\\?\\?)"].join(""));
/** A TODO is allowed only when it names its task id (RULES.md definition of done). */
const TODO_WITHOUT_TASK = /\bTODO\b(?!\s+T-[A-Z]?\d{2,3}\b)/;

describe("X-02 the non-null assertion pattern itself", () => {
  it.each(["a.b!.c", "f(x!)", "const y = x!;", "const y = x! as T", "return x!", "x! ?? y", "x!?? y", "arr[0]! + 1"])(
    "flags %j",
    (text) => {
      expect(NON_NULL_ASSERTION.test(text)).toBe(true);
    },
  );
  it.each(["a != b", "a!= b", "a !== b", "a!==b", "if (!ok) return", "!x && y", '"hi"'])("does not flag %j", (text) => {
    expect(NON_NULL_ASSERTION.test(text)).toBe(false);
  });
});

describe("X-02 src is free of forbidden patterns", () => {
  const files = listTsFiles(SRC_DIR);

  it("has at least the known source files", () => {
    expect(files.length).toBeGreaterThan(20);
  });
  it("has no console.log", () => {
    expect(findLines(files, CONSOLE_LOG)).toEqual([]);
  });
  it("has no any type annotations or casts", () => {
    expect(findLines(files, ANY_TYPE)).toEqual([]);
  });
  it("has no @ts-ignore style suppressions", () => {
    expect(findLines(files, TS_IGNORE)).toEqual([]);
  });
  it("has no non-null assertions", () => {
    expect(findLines(files, NON_NULL_ASSERTION)).toEqual([]);
  });
  it("has no TODO without a task id", () => {
    expect(findLines(files, TODO_WITHOUT_TASK)).toEqual([]);
  });
});

const ZOD_IMPORT = /from\s+["']zod["']/;
const LOCAL_SHAPE = /\bz\.(object|array|string|number|literal|enum|union)\(/;
const SHARED_IMPORT = /import\s*\{[^}]*\}\s*from\s*["']@predictx\/shared["']/;

describe("X-05 contract tests take every schema from @predictx/shared", () => {
  const files = listTsFiles(CONTRACT_DIR);

  it("covers the four contract files", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });
  it("never imports zod or builds a local shape", () => {
    expect(findLines(files, ZOD_IMPORT)).toEqual([]);
    expect(findLines(files, LOCAL_SHAPE)).toEqual([]);
  });
  it("imports its schemas from the shared package", () => {
    for (const file of files) expect(readFileSync(file, "utf8")).toMatch(SHARED_IMPORT);
  });
});
