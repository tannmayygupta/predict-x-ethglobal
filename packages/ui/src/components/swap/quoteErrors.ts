import { COPY } from "../../copy";

/**
 * Plain words for a failed quote. The backend's messages are written for developers ("body.amount: invalid decimal",
 * "VALIDATION_ERROR: Request validation failed"); the person typing an amount should never see those.
 */
export function quoteFailureText(code: string, message: string): string {
  if (code === "NETWORK" || code === "INTERNAL") return "Couldn't load the quote. Try again.";
  if (code === "FLASH_ERROR") return COPY.flash_unavailable;
  if (code === "RATE_LIMITED") return "Too many requests. Wait a moment, then try again.";
  if (/^body\./.test(message) || /invalid decimal|validation/i.test(message)) return COPY.check_inputs;
  return message;
}
