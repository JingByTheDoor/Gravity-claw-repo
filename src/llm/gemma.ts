export const GEMMA_VISION_TOKEN_BUDGETS = [70, 140, 280, 560, 1120] as const;

export type GemmaVisionTokenBudget = (typeof GEMMA_VISION_TOKEN_BUDGETS)[number];

export interface OllamaSamplingConfig {
  temperature: number;
  topP: number;
  topK: number;
}

export function prependGemmaThinkingToken(systemPrompt: string, enabled: boolean): string {
  if (!enabled) {
    return systemPrompt;
  }

  return `<|think|>\n${systemPrompt}`;
}

export function stripGemmaThinkingContent(content: string): string {
  let sanitized = content.replace(/\r\n/g, "\n");
  const leadingThoughtPatterns = [
    /^\s*<\|channel\|?>thought\s*\n[\s\S]*?<channel\|>\s*/i,
    /^\s*<think>\s*[\s\S]*?<\/think>\s*/i
  ];

  let changed = true;
  while (changed) {
    changed = false;

    for (const pattern of leadingThoughtPatterns) {
      const next = sanitized.replace(pattern, "");
      if (next !== sanitized) {
        sanitized = next;
        changed = true;
      }
    }
  }

  return sanitized.trim();
}
