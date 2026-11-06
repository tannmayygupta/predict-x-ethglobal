import type { FlashOrderDetail, FlashQuoteResponse } from "@predictx/shared";
import type { FlashQuoteInput, FlashStatusInput } from "../../../src/clients/flash.types";
import { FakeFlash as RecordingFlash } from "./flash";

/**
 * T-B04's spy around MockFlashClient: T-B03's FakeFlash (call log, failNextSubmit, failNextStatus)
 * plus the knobs the route tests need. Build it with the app's FakeClock so quote expiry follows
 * `built.clock`: buildTestApp({ clock, flash: new FakeFlash(clock) }).
 */
export class FakeFlash extends RecordingFlash {
  /** Thrown by the next quote() with its own message (B04-09); inner.failNextQuote only says "mock failure". */
  failNextQuoteWith: Error | null = null;
  /** Returned as steps.permitTypedData on every quote so the permit path (B04-19) is reachable. */
  permitTypedData: string | null = null;
  /** Merged into the next status() result, e.g. a filled order without a txHash (B04-26). */
  patchNextStatus: Partial<FlashOrderDetail> | null = null;
  /** Every quote returned, so tests can compare pass-through fields with toBe (B04-10). */
  readonly quotes: FlashQuoteResponse[] = [];

  override async quote(input: FlashQuoteInput): Promise<FlashQuoteResponse> {
    const failure = this.failNextQuoteWith;
    if (failure) {
      this.failNextQuoteWith = null;
      this.calls.push({ method: "quote", input });
      throw failure;
    }
    const base = await super.quote(input);
    const quote =
      this.permitTypedData === null
        ? base
        : { ...base, steps: { ...base.steps, permitTypedData: this.permitTypedData } };
    this.quotes.push(quote);
    return quote;
  }

  override async status(input: FlashStatusInput): Promise<FlashOrderDetail> {
    const detail = await super.status(input);
    const patch = this.patchNextStatus;
    if (!patch) return detail;
    this.patchNextStatus = null;
    return { ...detail, ...patch };
  }
}
