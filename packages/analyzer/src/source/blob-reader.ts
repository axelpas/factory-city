import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";

/** Reads blobs through one `git cat-file --batch` process, one request at a time. */
export class BlobReader {
  private readonly proc: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private waiting: (() => void) | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private failed: Error | undefined;

  constructor(cwd: string) {
    this.proc = spawn("git", ["cat-file", "--batch"], { cwd });
    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.waiting?.();
    });
    this.proc.on("error", (err) => {
      this.failed = err;
      this.waiting?.();
    });
    this.proc.stdin.on("error", () => {});
  }

  read(id: string): Promise<Buffer> {
    const run = this.queue.then(() => this.readOne(id));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readOne(id: string): Promise<Buffer> {
    this.proc.stdin.write(`${id}\n`);
    for (;;) {
      if (this.failed) throw this.failed;
      const nl = this.buffer.indexOf(10);
      if (nl >= 0) {
        const header = this.buffer.subarray(0, nl).toString("utf8");
        const parts = header.split(" ");
        if (parts[1] === "missing") throw new Error(`git object ${id} is missing`);
        const size = Number(parts[2]);
        const end = nl + 1 + size + 1;
        if (this.buffer.length >= end) {
          const content = Buffer.from(this.buffer.subarray(nl + 1, nl + 1 + size));
          this.buffer = this.buffer.subarray(end);
          return content;
        }
      }
      await new Promise<void>((ok) => {
        this.waiting = ok;
      });
    }
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}
