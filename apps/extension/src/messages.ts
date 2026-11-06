import type { HttpRequest, HttpResponse } from "@predictx/ui";

/** Content script -> service worker: "make this backend call for me" (decision D-T5). */
export const API_MESSAGE = "predictx:api" as const;

export interface ApiMessage {
  type: typeof API_MESSAGE;
  request: HttpRequest;
}

export type ApiReply = { ok: true; response: HttpResponse } | { ok: false; error: string };

export function isApiMessage(value: unknown): value is ApiMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<ApiMessage>;
  return v.type === API_MESSAGE && typeof v.request === "object" && v.request !== null;
}
