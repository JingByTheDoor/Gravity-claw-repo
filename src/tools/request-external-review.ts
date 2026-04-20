import type { ToolDefinition } from "../agent/types.js";
import { ApprovalStore } from "../approvals/store.js";
import type { ApprovalPolicy } from "../runtime/contracts.js";

export function createRequestExternalReviewTool(
  approvalStore: ApprovalStore,
  approvalPolicy: ApprovalPolicy
): ToolDefinition {
  return {
    name: "request_external_review",
    description:
      "Pause before sending an email, message, or other high-impact external action. Use this after preparing the action but before actually sending or submitting it.",
    parameters: {
      type: "object",
      properties: {
        action_title: {
          type: "string",
          description: "Short label for the action, such as 'Send Gmail reply to Alex'."
        },
        details: {
          type: "string",
          description: "What will be sent or done if the user approves it."
        },
        channel: {
          type: "string",
          description: "Optional channel, such as email, telegram, slack, or browser form."
        }
      },
      required: ["action_title", "details"],
      additionalProperties: false
    },
    async execute(input, context) {
      const actionTitle =
        typeof input.action_title === "string" ? input.action_title.trim() : "";
      const details = typeof input.details === "string" ? input.details.trim() : "";
      const channel = typeof input.channel === "string" ? input.channel.trim() : "";

      if (actionTitle.length === 0 || details.length === 0) {
        return JSON.stringify({
          ok: false,
          error: "action_title and details must be non-empty strings."
        });
      }

      if (
        !approvalPolicy.shouldRequestReview({
          kind: "external_action",
          ...(channel ? { channel } : {}),
          summary: actionTitle
        })
      ) {
        return JSON.stringify({
          ok: true,
          approved: true,
          bypassed: true
        });
      }

      const approval = approvalStore.createExternalActionApproval(
        context.chatId,
        actionTitle,
        details,
        context.taskId,
        channel ? { channel } : undefined
      );

      return JSON.stringify({
        ok: false,
        approvalRequired: true,
        approvalId: approval.id,
        kind: approval.kind,
        title: approval.title,
        details: approval.details,
        message: `External action requires approval. Ask the user to send /approve ${approval.id} or /deny ${approval.id}.`
      });
    }
  };
}
