import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_LOG_DIR } from "./defaults";
import { ScoreboardState } from "./scoreboard";

type ChangeHandler = () => void;
type LogHandler = (message: string, level?: "info" | "warn" | "error" | "success" | "debug") => void;

export class LogTailer {
  private timer: NodeJS.Timeout | null = null;
  private currentLog: string | null = null;
  private selectedLog: string | null = process.env.FF_LOG_FILE || null;
  private offset = 0;
  private partial = "";
  private reading = false;

  constructor(
    private readonly state: ScoreboardState,
    private readonly onChange: ChangeHandler,
    private readonly logDir = process.env.FF_LOG_DIR || DEFAULT_LOG_DIR,
    private readonly pollMs = 150,
    private readonly onLog: LogHandler = () => undefined
  ) {}

  start(): void {
    if (this.timer) return;
    this.onLog("Bắt đầu đọc log", "success");
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onLog("Đã dừng đọc log", "warn");
  }

  isRunning(): boolean {
    return Boolean(this.timer);
  }

  getCurrentLog(): string | null {
    return this.currentLog;
  }

  getSelectedLog(): string | null {
    return this.selectedLog;
  }

  useLogFile(filePath: string | null): void {
    const nextLog = filePath?.trim() || null;
    if (nextLog === this.selectedLog) return;

    this.selectedLog = nextLog;
    this.onLog(nextLog ? `Chọn log: ${nextLog}` : "Chuyển về tự động tìm log", "info");
    this.clearCurrentLog();
  }

  reload(): void {
    this.currentLog = null;
    this.offset = 0;
    this.partial = "";
    this.state.reset(null);
    this.onLog("Đã tải lại bộ đọc log", "info");
    this.onChange();
  }

  async tick(): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    try {
      const nextLog = this.selectedLog || (await this.findNewestLog());
      if (!nextLog || !(await this.canReadFile(nextLog))) {
        this.clearCurrentLog();
        return;
      }

      if (nextLog !== this.currentLog) {
        this.currentLog = nextLog;
        this.offset = 0;
        this.partial = "";
        this.state.reset(nextLog);
        this.onLog(`Đang đọc file: ${nextLog}`, "success");
      }

      await this.readAppended(nextLog);
    } catch (error) {
      console.warn("Log tailer tick failed:", error);
      this.onLog(`Lỗi đọc log: ${String(error)}`, "error");
    } finally {
      this.reading = false;
    }
  }

  private clearCurrentLog(): void {
    if (!this.currentLog) return;

    this.currentLog = null;
    this.offset = 0;
    this.partial = "";
    this.state.reset(null);
    this.onLog("Không có file log đang hoạt động", "warn");
    this.onChange();
  }

  private async canReadFile(filePath: string): Promise<boolean> {
    const stat = await fs.stat(filePath).catch(() => null);
    return Boolean(stat?.isFile());
  }

  private async findNewestLog(): Promise<string | null> {
    const entries = await fs.readdir(this.logDir, { withFileTypes: true }).catch(() => []);
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".log"))
        .map(async (entry) => {
          const fullPath = path.join(this.logDir, entry.name);
          const stat = await fs.stat(fullPath);
          return { fullPath, nameTimeMs: this.parseDebuggerNameTime(entry.name), mtimeMs: stat.mtimeMs };
        })
    );

    files.sort((a, b) => b.nameTimeMs - a.nameTimeMs || b.mtimeMs - a.mtimeMs);
    return files[0]?.fullPath || null;
  }

  private parseDebuggerNameTime(fileName: string): number {
    const match = fileName.match(/debugger-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.log$/i);
    if (!match) return 0;

    const [, year, month, day, hour, minute, second] = match;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    ).getTime();
  }

  private async readAppended(filePath: string): Promise<void> {
    const handle = await fs.open(filePath, "r");
    try {
      const stat = await handle.stat();
      if (stat.size < this.offset) {
        this.offset = 0;
        this.partial = "";
        this.state.reset(filePath);
      }

      if (stat.size === this.offset) return;

      const length = stat.size - this.offset;
      const buffer = Buffer.allocUnsafe(length);
      const result = await handle.read(buffer, 0, length, this.offset);
      this.offset += result.bytesRead;

      const changed = this.consumeText(buffer.subarray(0, result.bytesRead).toString("utf8"));
      if (changed) {
        this.state.sourceLogUpdatedAt = new Date(stat.mtimeMs).toISOString();
        this.onChange();
      }
    } finally {
      await handle.close();
    }
  }

  private consumeText(text: string): boolean {
    const chunk = this.partial + text;
    const lines = chunk.split(/\r?\n/);
    this.partial = lines.pop() || "";
    let changed = false;

    for (const line of lines) {
      if (this.state.consumeLine(line)) changed = true;
    }

    return changed;
  }
}
