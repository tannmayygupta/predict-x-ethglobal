import { InsightModelError, type InsightModel, type InsightModelInput } from "../../../src/clients/insightModel";

export class FakeInsightModel implements InsightModel {
  /** Replies are consumed in order; an Error entry is thrown instead of returned. */
  readonly replies: Array<unknown | Error> = [];
  readonly calls: InsightModelInput[] = [];

  queue(reply: unknown): void {
    this.replies.push(reply);
  }

  queueError(error: Error): void {
    this.replies.push(error);
  }

  async complete(input: InsightModelInput): Promise<unknown> {
    this.calls.push(input);
    if (this.replies.length === 0) throw new InsightModelError("no reply queued in FakeInsightModel");
    const next = this.replies.shift();
    if (next instanceof Error) throw next;
    return next;
  }
}
