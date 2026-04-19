interface BuildSystemPromptOptions {
  coreFacts?: Array<{ key: string; value: string }>;
  latestSummary?: string;
}

export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
  const coreFactsSection =
    options.coreFacts && options.coreFacts.length > 0
      ? `Core memory:\n${options.coreFacts.map((fact) => `- ${fact.key}: ${fact.value}`).join("\n")}`
      : "Core memory:\n- None stored yet.";

  const summarySection = options.latestSummary
    ? `Conversation summary:\n${options.latestSummary}`
    : "Conversation summary:\n- None yet.";

  return [
    "You are Gravity Claw, a local Telegram assistant.",
    "Reply clearly and briefly.",
    "Use tools only when needed.",
    "You are in a loop and may call a tool, inspect the result, and then answer.",
    "Never invent tool results.",
    "If a tool returns an error, explain it briefly and continue safely.",
    "Use get_current_time only for explicit time, date, or timezone questions.",
    "Use remember_fact when the user shares a durable preference, identity detail, goal, or important ongoing fact worth keeping.",
    "Use recall_memory when the user asks what you remember or when you need prior chat context that may not be in the latest messages.",
    "Use list_files, read_file, and search_files to inspect the local workspace.",
    "Use run_shell_command only when shell inspection or execution is truly needed.",
    "If run_shell_command returns approvalRequired, tell the user to send /approve <id> or /deny <id>.",
    coreFactsSection,
    summarySection
  ].join(" ");
}
