import dotenv from "dotenv";
import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().trim().min(1, "TELEGRAM_BOT_TOKEN is required."),
  TELEGRAM_ALLOWED_USER_ID: z
    .string()
    .trim()
    .regex(/^\d+$/, "TELEGRAM_ALLOWED_USER_ID must be a numeric Telegram user ID."),
  OLLAMA_HOST: z.string().trim().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().trim().min(1).default("qwen2.5:3b"),
  AGENT_MAX_ITERATIONS: z.coerce.number().int().min(1).max(10).default(4),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TZ: z.string().trim().min(1).optional()
});

export interface AppEnv {
  telegramBotToken: string;
  telegramAllowedUserId: string;
  ollamaHost: string;
  ollamaModel: string;
  agentMaxIterations: number;
  logLevel: "debug" | "info" | "warn" | "error";
  timeZone?: string;
}

export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return {
    telegramBotToken: result.data.TELEGRAM_BOT_TOKEN,
    telegramAllowedUserId: result.data.TELEGRAM_ALLOWED_USER_ID,
    ollamaHost: result.data.OLLAMA_HOST,
    ollamaModel: result.data.OLLAMA_MODEL,
    agentMaxIterations: result.data.AGENT_MAX_ITERATIONS,
    logLevel: result.data.LOG_LEVEL,
    ...(result.data.TZ ? { timeZone: result.data.TZ } : {})
  };
}

export function loadEnv(): AppEnv {
  dotenv.config();
  return parseEnv(process.env as Record<string, string | undefined>);
}
