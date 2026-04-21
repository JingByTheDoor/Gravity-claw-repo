import fs from "node:fs/promises";
import type { Logger } from "../logging/logger.js";
import type { GemmaVisionTokenBudget, OllamaSamplingConfig } from "../llm/gemma.js";
import { stripGemmaThinkingContent } from "../llm/gemma.js";
import { buildOllamaRequestOptions } from "../llm/options.js";

export interface OcrReadResult {
  ok: boolean;
  text: string;
  lines: string[];
}

export interface FindElementResult {
  ok: boolean;
  found: boolean;
  label: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
}

interface VisionClientOptions {
  host: string;
  model: string;
  logger: Logger;
  sampling: OllamaSamplingConfig;
  visionTokenBudget?: GemmaVisionTokenBudget;
  fetchImpl?: typeof fetch;
}

interface OllamaVisionMessage {
  role: "user";
  content: string;
  images: string[];
}

interface OllamaVisionResponse {
  message?: {
    content?: string;
  };
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Vision model did not return JSON.");
  }

  return match[0];
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) =>
    typeof entry === "string" && entry.trim().length > 0 ? [entry.trim()] : []
  );
}

export class VisionClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: VisionClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async checkHealth(): Promise<void> {
    const response = await this.fetchImpl(this.buildUrl("/api/tags"));
    if (!response.ok) {
      throw new Error(`Ollama vision health check failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { models?: Array<{ name?: string }> };
    const modelNames = new Set(
      (payload.models ?? []).flatMap((model) => (model.name ? [model.name] : []))
    );
    if (!modelNames.has(this.options.model)) {
      throw new Error(`Configured Ollama vision model "${this.options.model}" is not available locally.`);
    }
  }

  async ocrRead(imagePath: string): Promise<OcrReadResult> {
    const payload = await this.runVisionJson(imagePath, [
      "Read all visible text from this screenshot.",
      "Return strict JSON with this shape only:",
      '{"text":"full extracted text","lines":["line 1","line 2"]}',
      "Preserve line breaks as well as possible."
    ].join(" "));

    return {
      ok: true,
      text: typeof payload.text === "string" ? payload.text.trim() : "",
      lines: toStringArray(payload.lines)
    };
  }

  async findElement(imagePath: string, query: string): Promise<FindElementResult> {
    const payload = await this.runVisionJson(imagePath, [
      `Find the UI element that best matches this query: "${query}".`,
      "Return strict JSON only with this shape:",
      '{"found":true,"label":"element label","confidence":0.0,"x":0,"y":0,"width":0,"height":0,"reason":"short reason"}',
      "Coordinates must be pixel values relative to the screenshot top-left corner.",
      "If the element is not visible, return found false and set the numbers to 0."
    ].join(" "));

    return {
      ok: true,
      found: payload.found === true,
      label: typeof payload.label === "string" ? payload.label.trim() : "",
      confidence: Math.max(0, Math.min(1, toNumber(payload.confidence, 0))),
      x: Math.max(0, Math.trunc(toNumber(payload.x, 0))),
      y: Math.max(0, Math.trunc(toNumber(payload.y, 0))),
      width: Math.max(0, Math.trunc(toNumber(payload.width, 0))),
      height: Math.max(0, Math.trunc(toNumber(payload.height, 0))),
      reason: typeof payload.reason === "string" ? payload.reason.trim() : ""
    };
  }

  private async runVisionJson(
    imagePath: string,
    prompt: string
  ): Promise<Record<string, unknown>> {
    const imageBytes = await fs.readFile(imagePath);
    const url = this.buildUrl("/api/chat");
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          format: "json",
          messages: [{
            role: "user",
            content: prompt,
            images: [imageBytes.toString("base64")]
          } satisfies OllamaVisionMessage],
          options: buildOllamaRequestOptions(this.options.sampling, this.options.visionTokenBudget)
        })
      });

      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }

      const payload = (await response.json()) as OllamaVisionResponse;
      const content = payload.message?.content
        ? stripGemmaThinkingContent(payload.message.content)
        : undefined;
      if (!content) {
        throw new Error("missing message content");
      }

      const jsonString = extractJsonObject(content);
      const parsed = JSON.parse(jsonString) as Record<string, unknown>;

      this.options.logger.debug("vision.response.ok", {
        imagePath,
        promptLength: prompt.length
      });

      return parsed;
    } catch (error) {
      throw this.normalizeVisionError(error, url, imagePath);
    }
  }

  private buildUrl(pathname: string): string {
    const base = this.options.host.replace(/\/+$/, "");
    return `${base}${pathname}`;
  }

  private normalizeVisionError(error: unknown, url: string, imagePath: string): Error {
    if (error instanceof Error) {
      if (/^Ollama vision request failed/i.test(error.message)) {
        return error;
      }

      return new Error(
        `Ollama vision request failed for model "${this.options.model}" at ${url} while processing ${imagePath}: ${error.message}`
      );
    }

    return new Error(
      `Ollama vision request failed for model "${this.options.model}" at ${url} while processing ${imagePath}: ${String(error)}`
    );
  }
}
