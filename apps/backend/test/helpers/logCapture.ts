/** Collects pino JSON lines written by the app so tests can assert on log content. */
export class LogCapture {
  readonly lines: string[] = [];

  write(msg: string): void {
    this.lines.push(msg);
  }

  entries(): Array<Record<string, unknown>> {
    return this.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  text(): string {
    return this.lines.join("");
  }
}
