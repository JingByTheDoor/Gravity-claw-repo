import type { GemmaVisionTokenBudget, OllamaSamplingConfig } from "./gemma.js";

export interface OllamaRequestOptions {
  temperature: number;
  top_p: number;
  top_k: number;
  visual_token_budget?: GemmaVisionTokenBudget;
}

export function buildOllamaRequestOptions(
  sampling: OllamaSamplingConfig,
  visionTokenBudget?: GemmaVisionTokenBudget
): OllamaRequestOptions {
  return {
    temperature: sampling.temperature,
    top_p: sampling.topP,
    top_k: sampling.topK,
    ...(visionTokenBudget !== undefined ? { visual_token_budget: visionTokenBudget } : {})
  };
}
