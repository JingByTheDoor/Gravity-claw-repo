import dotenv from "dotenv";
import { z } from "zod";
import { GEMMA_VISION_TOKEN_BUDGETS, type GemmaVisionTokenBudget } from "../llm/gemma.js";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().trim().min(1, "TELEGRAM_BOT_TOKEN is required."),
  TELEGRAM_ALLOWED_USER_ID: z
    .string()
    .trim()
    .regex(/^\d+$/, "TELEGRAM_ALLOWED_USER_ID must be a numeric Telegram user ID."),
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().trim().min(1).optional(),
  OLLAMA_HOST: z.string().trim().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().trim().min(1).default("qwen2.5:3b"),
  OLLAMA_FAST_MODEL: z.string().trim().min(1).optional(),
  OLLAMA_VISION_MODEL: z.string().trim().min(1).optional(),
  OLLAMA_TEMPERATURE: z.coerce.number().min(0).default(1),
  OLLAMA_TOP_P: z.coerce.number().gt(0).max(1).default(0.95),
  OLLAMA_TOP_K: z.coerce.number().int().positive().default(64),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().max(131072).default(4096),
  OLLAMA_ENABLE_THINKING: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OLLAMA_VISION_TOKEN_BUDGET: z
    .enum(GEMMA_VISION_TOKEN_BUDGETS.map((value) => String(value)) as [string, ...string[]])
    .optional()
    .transform((value) => (value === undefined ? undefined : Number(value) as GemmaVisionTokenBudget)),
  WORKER_LABEL: z.string().trim().min(1).default("Gravity Claw Worker"),
  WORKER_MODE: z.enum(["local", "vm"]).default("local"),
  WORKER_HOST_PROFILE_ROOT: z.string().trim().min(1).optional(),
  BROWSER_USER_DATA_DIR: z.string().trim().min(1).optional(),
  BROWSER_HEADLESS: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  EMAIL_NOTIFICATIONS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  EMAIL_NOTIFICATION_FROM: z.string().trim().min(1).optional(),
  EMAIL_NOTIFICATION_TO: z.string().trim().min(1).optional(),
  SMTP_HOST: z.string().trim().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === undefined ? undefined : value === "true"),
  SMTP_USER: z.string().trim().min(1).optional(),
  SMTP_PASSWORD: z.string().trim().min(1).optional(),
  AGENT_MAX_ITERATIONS: z.coerce.number().int().min(1).max(10).default(4),
  DATABASE_PATH: z.string().trim().min(1).default("gravity-claw.db"),
  WORKSPACE_ROOT: z.string().trim().min(1).optional(),
  TOOL_ALLOWED_ROOTS: z.string().trim().min(1).optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TZ: z.string().trim().min(1).optional()
});

export interface AppEnv {
  telegramBotToken: string;
  telegramAllowedUserId: string;
  telegramAllowedChatIds: string[];
  ollamaHost: string;
  ollamaModel: string;
  ollamaFastModel: string;
  ollamaVisionModel: string;
  ollamaTemperature: number;
  ollamaTopP: number;
  ollamaTopK: number;
  ollamaNumCtx: number;
  ollamaEnableThinking: boolean;
  ollamaVisionTokenBudget?: GemmaVisionTokenBudget;
  workerLabel: string;
  workerMode: "local" | "vm";
  workerHostProfileRoot?: string;
  browserUserDataDir?: string;
  browserHeadless: boolean;
  emailNotificationsEnabled: boolean;
  emailNotificationFrom?: string;
  emailNotificationTo?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  agentMaxIterations: number;
  databasePath: string;
  workspaceRoot?: string;
  toolAllowedRoots: string[];
  logLevel: "debug" | "info" | "warn" | "error";
  timeZone?: string;
}

function parseAllowedRoots(rawValue?: string): string[] {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(/[\r\n;,]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseAllowedChatIds(rawValue?: string): string[] {
  if (!rawValue) {
    return [];
  }

  return [...new Set(
    rawValue
      .split(/[\r\n;,]+/)
      .map((value) => value.trim())
      .filter((value) => /^-?\d+$/.test(value))
  )];
}

export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const ollamaModel = result.data.OLLAMA_MODEL;
  const ollamaFastModel = result.data.OLLAMA_FAST_MODEL?.trim() || ollamaModel;
  const ollamaVisionModel = result.data.OLLAMA_VISION_MODEL?.trim() || ollamaModel;

  return {
    telegramBotToken: result.data.TELEGRAM_BOT_TOKEN,
    telegramAllowedUserId: result.data.TELEGRAM_ALLOWED_USER_ID,
    telegramAllowedChatIds: parseAllowedChatIds(result.data.TELEGRAM_ALLOWED_CHAT_IDS),
    ollamaHost: result.data.OLLAMA_HOST,
    ollamaModel,
    ollamaFastModel,
    ollamaVisionModel,
    ollamaTemperature: result.data.OLLAMA_TEMPERATURE,
    ollamaTopP: result.data.OLLAMA_TOP_P,
    ollamaTopK: result.data.OLLAMA_TOP_K,
    ollamaNumCtx: result.data.OLLAMA_NUM_CTX,
    ollamaEnableThinking: result.data.OLLAMA_ENABLE_THINKING,
    ...(result.data.OLLAMA_VISION_TOKEN_BUDGET !== undefined
      ? { ollamaVisionTokenBudget: result.data.OLLAMA_VISION_TOKEN_BUDGET }
      : {}),
    workerLabel: result.data.WORKER_LABEL,
    workerMode: result.data.WORKER_MODE,
    ...(result.data.WORKER_HOST_PROFILE_ROOT
      ? { workerHostProfileRoot: result.data.WORKER_HOST_PROFILE_ROOT }
      : {}),
    ...(result.data.BROWSER_USER_DATA_DIR
      ? { browserUserDataDir: result.data.BROWSER_USER_DATA_DIR }
      : {}),
    browserHeadless: result.data.BROWSER_HEADLESS,
    emailNotificationsEnabled: result.data.EMAIL_NOTIFICATIONS_ENABLED,
    ...(result.data.EMAIL_NOTIFICATION_FROM
      ? { emailNotificationFrom: result.data.EMAIL_NOTIFICATION_FROM }
      : {}),
    ...(result.data.EMAIL_NOTIFICATION_TO
      ? { emailNotificationTo: result.data.EMAIL_NOTIFICATION_TO }
      : {}),
    ...(result.data.SMTP_HOST ? { smtpHost: result.data.SMTP_HOST } : {}),
    ...(result.data.SMTP_PORT ? { smtpPort: result.data.SMTP_PORT } : {}),
    ...(result.data.SMTP_SECURE !== undefined ? { smtpSecure: result.data.SMTP_SECURE } : {}),
    ...(result.data.SMTP_USER ? { smtpUser: result.data.SMTP_USER } : {}),
    ...(result.data.SMTP_PASSWORD ? { smtpPassword: result.data.SMTP_PASSWORD } : {}),
    agentMaxIterations: result.data.AGENT_MAX_ITERATIONS,
    databasePath: result.data.DATABASE_PATH,
    ...(result.data.WORKSPACE_ROOT ? { workspaceRoot: result.data.WORKSPACE_ROOT } : {}),
    toolAllowedRoots: parseAllowedRoots(result.data.TOOL_ALLOWED_ROOTS),
    logLevel: result.data.LOG_LEVEL,
    ...(result.data.TZ ? { timeZone: result.data.TZ } : {})
  };
}

export function loadEnv(): AppEnv {
  dotenv.config();
  return parseEnv(process.env as Record<string, string | undefined>);
}
