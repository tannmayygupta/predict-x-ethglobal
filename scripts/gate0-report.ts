/**
 * Recording and reporting half of Gate 0 (scripts/gate0-flash.ts): captures every Flash exchange through an
 * injected fetch, redacts secrets, and writes docs/GATE0.md plus fixture-shaped bodies under docs/gate0/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { FetchLike } from "../apps/backend/src/clients/flash.http";
import { redact } from "./gate0-redact";

export interface Recorded {
  label: string;
  request: unknown;
  status: number;
  response: unknown;
}

const REPORT_PATH = fileURLToPath(new URL("../docs/GATE0.md", import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL("../docs/gate0/", import.meta.url));
const HTTP_OK_MAX = 299;
const JSON_INDENT = 2;

function parseJson(text: unknown): unknown {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Wraps real fetch so every Flash exchange lands in the report; the client itself stays untouched. */
export function recordingFetch(records: Recorded[], apiKey: string): FetchLike {
  return async (input, init) => {
    const response = await fetch(input, init);
    const text = await response.clone().text();
    const url = new URL(String(input));
    records.push({
      label: `${init?.method ?? "GET"} ${url.pathname}${url.search}`,
      request: redact(parseJson(init?.body), apiKey),
      status: response.status,
      response: redact(parseJson(text), apiKey),
    });
    return response;
  };
}

function fence(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, JSON_INDENT)}\n\`\`\``;
}

/** "open" / "filled" style file suffix from a raw get-order body, falling back to "raw". */
function statusWord(body: unknown): string {
  const status = z.object({ order: z.object({ status: z.string() }) }).safeParse(body);
  if (!status.success) return "raw";
  return status.data.order.status.replace("ORDER_STATUS_", "").toLowerCase();
}

/** Names follow test/fixtures/flash so a human can copy the real bodies over the placeholders (B04-31). */
function fixtureName(record: Recorded): string | undefined {
  if (record.status > HTTP_OK_MAX) return "error.4xx.json";
  if (record.label.startsWith("POST /quote")) return "quote.ok.json";
  if (record.label.startsWith("POST /order")) return "order.ok.json";
  if (record.label.startsWith("GET /orders/")) return `status.${statusWord(record.response)}.json`;
  return undefined;
}

/** Writes the summary lines plus every recorded exchange; returns what was written for the caller to print. */
export function writeReport(summary: string[], records: Recorded[]): string {
  const sections = records.map(
    (r) => `### ${r.label}\n\nRequest:\n\n${fence(r.request)}\n\nResponse ${r.status}:\n\n${fence(r.response)}`,
  );
  writeFileSync(REPORT_PATH, [...summary, "", "## Raw bodies (redacted)", "", ...sections, ""].join("\n"));
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const named = new Map<string, unknown>();
  for (const record of records) {
    const name = fixtureName(record);
    if (name) named.set(name, record.response);
  }
  for (const [name, body] of named) {
    writeFileSync(`${FIXTURES_DIR}${name}`, `${JSON.stringify(body, null, JSON_INDENT)}\n`);
  }
  return `wrote ${REPORT_PATH} and ${named.size} bodies under ${FIXTURES_DIR}`;
}
