import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("supervisor scripts", () => {
  it("tracks per-run log metadata in the supervisor", () => {
    const script = fs.readFileSync(path.join(repoRoot, "scripts", "bot-supervisor.ps1"), "utf8");

    expect(script).toContain('Join-Path $logsDir "runs"');
    expect(script).toContain('Join-Path $runtimeDir "bot-run.json"');
    expect(script).toContain("Write-RunMetadata");
    expect(script).toContain("Clear-RunMetadata");
  });

  it("prints current bot run logs from metadata in the start helper", () => {
    const script = fs.readFileSync(path.join(repoRoot, "scripts", "start-bot-background.ps1"), "utf8");

    expect(script).toContain('Join-Path $runtimeDir "bot-run.json"');
    expect(script).toContain("Current bot stdout log:");
    expect(script).toContain("Current bot stderr log:");
  });
});
