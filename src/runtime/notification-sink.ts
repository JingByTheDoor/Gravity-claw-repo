import type { Transporter } from "nodemailer";
import type { Logger } from "../logging/logger.js";
import type { ArtifactRef, NotificationSink, RunEvent } from "./contracts.js";

export interface TelegramNotificationTarget {
  sendText(text: string): Promise<void>;
  sendImage?(path: string, caption?: string): Promise<void>;
}

function renderArtifactList(artifacts: ArtifactRef[]): string | undefined {
  if (artifacts.length === 0) {
    return undefined;
  }

  return artifacts
    .map((artifact) => `- ${artifact.kind}: ${artifact.label ?? artifact.path}`)
    .join("\n");
}

export class TelegramContextNotificationSink implements NotificationSink {
  constructor(
    private readonly target: TelegramNotificationTarget,
    private readonly logger: Logger
  ) {}

  async notify(event: RunEvent): Promise<void> {
    try {
      switch (event.type) {
        case "progress":
        case "warning":
        case "approval_requested":
        case "approval_resolved":
        case "task_completed":
        case "task_failed":
        case "task_canceled":
          await this.target.sendText(event.message);
          return;
        case "artifact_recorded":
          if (event.artifact && this.target.sendImage && event.artifact.kind === "image") {
            await this.target.sendImage(event.artifact.path, event.artifact.label);
          }
          return;
        default:
          return;
      }
    } catch (error) {
      this.logger.warn("notification.telegram.failed", {
        type: event.type,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export class CompositeNotificationSink implements NotificationSink {
  constructor(private readonly sinks: NotificationSink[]) {}

  async notify(event: RunEvent): Promise<void> {
    for (const sink of this.sinks) {
      await sink.notify(event);
    }
  }
}

interface EmailNotificationSinkOptions {
  enabled: boolean;
  from?: string;
  to?: string;
  subjectPrefix?: string;
  transport: Transporter;
  logger: Logger;
}

export class EmailNotificationSink implements NotificationSink {
  private readonly enabled: boolean;
  private readonly subjectPrefix: string;

  constructor(private readonly options: EmailNotificationSinkOptions) {
    this.enabled =
      options.enabled &&
      Boolean(options.from?.trim()) &&
      Boolean(options.to?.trim());
    this.subjectPrefix = options.subjectPrefix?.trim() || "Gravity Claw";
  }

  async notify(event: RunEvent): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (!["approval_requested", "task_completed", "task_failed", "task_canceled"].includes(event.type)) {
      return;
    }

    const artifacts = Array.isArray(event.data?.artifacts)
      ? (event.data.artifacts as ArtifactRef[])
      : [];
    const artifactSummary = renderArtifactList(artifacts);

    try {
      await this.options.transport.sendMail({
        from: this.options.from,
        to: this.options.to,
        subject: `${this.subjectPrefix}: ${event.type.replace(/_/g, " ")} (${event.taskId})`,
        text: [
          event.message,
          artifactSummary ? `\nArtifacts:\n${artifactSummary}` : undefined
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n"),
        attachments: artifacts.map((artifact) => ({
          filename: artifact.label ?? artifact.path.split(/[\\/]/).at(-1) ?? "artifact",
          path: artifact.path
        }))
      });
    } catch (error) {
      this.options.logger.warn("notification.email.failed", {
        type: event.type,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
