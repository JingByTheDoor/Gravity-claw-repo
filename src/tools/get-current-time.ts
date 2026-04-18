import type { ToolDefinition } from "../agent/types.js";

function getSystemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function createErrorPayload(error: string, timezone?: string): string {
  return JSON.stringify({
    ok: false,
    error,
    timezone
  });
}

export function createGetCurrentTimeTool(): ToolDefinition {
  return {
    name: "get_current_time",
    description: "Get the current date and time. Optional timezone in IANA format.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "Optional IANA timezone, for example America/Vancouver"
        }
      },
      additionalProperties: false
    },
    async execute(input) {
      const requestedTimezone = input.timezone;
      if (requestedTimezone !== undefined && typeof requestedTimezone !== "string") {
        return createErrorPayload("Timezone must be a string.");
      }

      const timezone = requestedTimezone ?? getSystemTimezone();
      if (!isValidTimezone(timezone)) {
        return createErrorPayload(`Invalid timezone: ${timezone}`, timezone);
      }

      const now = new Date();
      const localTime = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        dateStyle: "full",
        timeStyle: "medium"
      }).format(now);

      return JSON.stringify({
        ok: true,
        timezone,
        utcIso: now.toISOString(),
        localTime
      });
    }
  };
}
