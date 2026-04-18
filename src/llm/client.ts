import type { LLMRunRequest, LLMRunResponse } from "../agent/types.js";

export interface LLMClient {
  checkHealth(): Promise<void>;
  runStep(request: LLMRunRequest): Promise<LLMRunResponse>;
}
