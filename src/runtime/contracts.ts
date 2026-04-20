import type { LLMClient } from "../llm/client.js";
import type { Logger } from "../logging/logger.js";
import type { BrowserController } from "../tools/browser-controller.js";
import type { DesktopController } from "../tools/desktop-controller.js";
import type { ShellRunner } from "../tools/shell-runner.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { VisionClient } from "../tools/vision-client.js";
import type { PathAccessPolicy } from "../tools/workspace.js";

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "canceled";

export interface Task {
  id: string;
  chatId: string;
  userInput: string;
  status: TaskStatus;
  parentTaskId?: string;
  replyText?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export type RunEventType =
  | "task_created"
  | "task_running"
  | "progress"
  | "warning"
  | "approval_requested"
  | "approval_resolved"
  | "artifact_recorded"
  | "task_completed"
  | "task_failed"
  | "task_canceled";

export interface ArtifactRef {
  kind: "image" | "file" | "log";
  path: string;
  label?: string;
  createdAt?: string;
}

export interface ApprovalRequest {
  id: string;
  kind: "shell_command" | "external_action";
  chatId: string;
  taskId?: string;
  title: string;
  details: string;
  createdAt: string;
}

export interface RunEvent {
  taskId: string;
  chatId: string;
  type: RunEventType;
  message: string;
  createdAt: string;
  status?: TaskStatus;
  approval?: ApprovalRequest;
  artifact?: ArtifactRef;
  data?: Record<string, unknown>;
}

export interface ModelProvider {
  readonly kind: string;
  readonly endpoint: string;
  createChatClient(model: string): LLMClient;
  createVisionClient(model: string): VisionClient;
}

export interface WorkerSession {
  readonly label: string;
  readonly mode: "local" | "vm";
  readonly hostProfileRoot?: string;
  readonly browserProfileDir?: string;
  readonly pathAccessPolicy: PathAccessPolicy;
  readonly toolRegistry: ToolRegistry;
  readonly browserController: BrowserController;
  readonly desktopController: DesktopController;
  readonly shellRunner: ShellRunner;
  readonly logger: Logger;
}

export interface NotificationSink {
  notify(event: RunEvent): Promise<void>;
}

export interface ApprovalPolicy {
  shouldRequestReview(action: {
    kind: "external_action";
    channel?: string;
    summary: string;
  }): boolean;
}

export interface ArtifactStore {
  recordArtifact(taskId: string, artifact: Omit<ArtifactRef, "createdAt">): ArtifactRef;
  listArtifacts(taskId: string): ArtifactRef[];
}
