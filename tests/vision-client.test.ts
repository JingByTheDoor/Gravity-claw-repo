import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logging/logger.js";
import { VisionClient } from "../src/tools/vision-client.js";

const tempFiles: string[] = [];

function createTempImage(): string {
  const filePath = path.join(os.tmpdir(), `gravity-claw-vision-${Date.now()}-${Math.random()}.png`);
  fs.writeFileSync(filePath, Buffer.from("fake-image"));
  tempFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  for (const filePath of tempFiles.splice(0)) {
    fs.rmSync(filePath, { force: true });
  }
});

describe("VisionClient", () => {
  it("verifies that the configured vision model exists locally", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        models: [{ name: "gemma4:latest" }]
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const client = new VisionClient({
      host: "http://127.0.0.1:11434",
      model: "gemma4:latest",
      logger: createLogger("error"),
      fetchImpl: fetchImpl as typeof fetch
    });

    await expect(client.checkHealth()).resolves.toBeUndefined();
  });

  it("parses OCR responses from Ollama vision", async () => {
    const imagePath = createTempImage();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        message: {
          content: '{"text":"Hello world","lines":["Hello world"]}'
        }
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const client = new VisionClient({
      host: "http://127.0.0.1:11434",
      model: "gemma4:latest",
      logger: createLogger("error"),
      fetchImpl: fetchImpl as typeof fetch
    });

    const result = await client.ocrRead(imagePath);

    expect(result.ok).toBe(true);
    expect(result.text).toBe("Hello world");
    expect(result.lines).toEqual(["Hello world"]);
  });

  it("parses element finding responses from Ollama vision", async () => {
    const imagePath = createTempImage();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        message: {
          content:
            '```json\n{"found":true,"label":"Open button","confidence":0.91,"x":100,"y":200,"width":50,"height":20,"reason":"visible in toolbar"}\n```'
        }
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const client = new VisionClient({
      host: "http://127.0.0.1:11434",
      model: "gemma4:latest",
      logger: createLogger("error"),
      fetchImpl: fetchImpl as typeof fetch
    });

    const result = await client.findElement(imagePath, "Open button");

    expect(result.ok).toBe(true);
    expect(result.found).toBe(true);
    expect(result.label).toBe("Open button");
    expect(result.x).toBe(100);
    expect(result.height).toBe(20);
  });

  it("wraps fetch failures with model and image context", async () => {
    const imagePath = createTempImage();
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });

    const client = new VisionClient({
      host: "http://127.0.0.1:11434",
      model: "gemma4:latest",
      logger: createLogger("error"),
      fetchImpl: fetchImpl as typeof fetch
    });

    await expect(client.ocrRead(imagePath)).rejects.toThrow(
      `Ollama vision request failed for model "gemma4:latest" at http://127.0.0.1:11434/api/chat while processing ${imagePath}: fetch failed`
    );
  });
});
