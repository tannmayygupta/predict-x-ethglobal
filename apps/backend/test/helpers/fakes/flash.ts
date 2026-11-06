import type { FlashOrderDetail, FlashQuoteResponse } from "@predictx/shared";
import { MockFlashClient } from "../../../src/clients/flash.mock";
import {
  FlashError,
  type FlashClient,
  type FlashOrderResponse,
  type FlashQuoteInput,
  type FlashStatusInput,
  type FlashSubmitInput,
} from "../../../src/clients/flash.types";
import type { Clock } from "../../../src/util/clock";
import { FakeClock } from "./clock";

/** Default Flash adapter for tests that never trade. */
export class NotConfiguredFlash implements FlashClient {
  async quote(): Promise<FlashQuoteResponse> {
    throw new FlashError("flash not configured in this test");
  }

  async submit(): Promise<FlashOrderResponse> {
    throw new FlashError("flash not configured in this test");
  }

  async status(): Promise<FlashOrderDetail> {
    throw new FlashError("flash not configured in this test");
  }
}

export type FakeFlashCall =
  | { method: "quote"; input: FlashQuoteInput }
  | { method: "submit"; input: FlashSubmitInput }
  | { method: "status"; input: FlashStatusInput };

/**
 * Spy around MockFlashClient for route tests: records every call and can fail the next one.
 * Pass the app's FakeClock so quote expiry follows `built.clock`: buildTestApp({ clock, flash: new FakeFlash(clock) }).
 */
export class FakeFlash implements FlashClient {
  readonly inner: MockFlashClient;
  readonly calls: FakeFlashCall[] = [];
  /** Thrown by the next submit() / status() respectively, then cleared; quote failures use inner.failNextQuote. */
  failNextSubmit: Error | null = null;
  failNextStatus: Error | null = null;

  constructor(clock: Clock = new FakeClock()) {
    this.inner = new MockFlashClient(clock);
  }

  get failNextQuote(): boolean {
    return this.inner.failNextQuote;
  }

  set failNextQuote(value: boolean) {
    this.inner.failNextQuote = value;
  }

  async quote(input: FlashQuoteInput): Promise<FlashQuoteResponse> {
    this.calls.push({ method: "quote", input });
    return this.inner.quote(input);
  }

  async submit(input: FlashSubmitInput): Promise<FlashOrderResponse> {
    this.calls.push({ method: "submit", input });
    const failure = this.failNextSubmit;
    if (failure) {
      this.failNextSubmit = null;
      throw failure;
    }
    return this.inner.submit(input);
  }

  async status(input: FlashStatusInput): Promise<FlashOrderDetail> {
    this.calls.push({ method: "status", input });
    const failure = this.failNextStatus;
    if (failure) {
      this.failNextStatus = null;
      throw failure;
    }
    return this.inner.status(input);
  }
}
