import type { ToolDefinition, ToolExecutionContext } from "../agent/types.js";
import { ApprovalStore } from "../approvals/store.js";
import type { Logger } from "../logging/logger.js";
import { MemoryStore } from "../memory/store.js";
import { AppLauncher } from "./app-launcher.js";
import { BrowserController } from "./browser-controller.js";
import { createBrowserClickTool } from "./browser-click.js";
import { createBrowserCloseTool } from "./browser-close.js";
import { createBrowserNavigateTool } from "./browser-navigate.js";
import { createBrowserSearchTool } from "./browser-search.js";
import { createBrowserScreenshotTool } from "./browser-screenshot.js";
import { createBrowserSnapshotTool } from "./browser-snapshot.js";
import { createBrowserTypeTool } from "./browser-type.js";
import { createClipboardReadTool } from "./clipboard-read.js";
import { createClipboardWriteTool } from "./clipboard-write.js";
import { createClickElementTool } from "./click-element.js";
import { createCloseAppTool } from "./close-app.js";
import { DesktopController } from "./desktop-controller.js";
import { createFindElementTool } from "./find-element.js";
import { createFetchWebPageTool } from "./fetch-web-page.js";
import { createFocusAppTool } from "./focus-app.js";
import { createGetActiveAppTool } from "./get-active-app.js";
import { createGetCurrentTimeTool } from "./get-current-time.js";
import { createKeyboardHotkeyTool } from "./keyboard-hotkey.js";
import { createKeyboardTypeTool } from "./keyboard-type.js";
import { createLaunchAppTool } from "./launch-app.js";
import { createListAppsTool } from "./list-apps.js";
import { createListFilesTool } from "./list-files.js";
import { createMouseClickTool } from "./mouse-click.js";
import { createOcrReadTool } from "./ocr-read.js";
import { createReadFileTool } from "./read-file.js";
import { createRecallMemoryTool } from "./recall-memory.js";
import { createRememberFactTool } from "./remember-fact.js";
import { createRequestExternalReviewTool } from "./request-external-review.js";
import { createResolveKnownFolderTool } from "./resolve-known-folder.js";
import { createReplaceInFileTool } from "./replace-in-file.js";
import { createRunShellCommandTool } from "./run-shell-command.js";
import { createSearchFilesTool } from "./search-files.js";
import { createSearchWebTool } from "./search-web.js";
import { createTakeActiveWindowScreenshotTool } from "./take-active-window-screenshot.js";
import { createTakeScreenshotTool } from "./take-screenshot.js";
import { VisionClient } from "./vision-client.js";
import { createWaitForElementTool } from "./wait-for-element.js";
import { createWriteFileTool } from "./write-file.js";
import { ShellRunner } from "./shell-runner.js";
import type { PathAccessPolicy } from "./workspace.js";
import type { ApprovalPolicy } from "../runtime/contracts.js";

function createToolError(message: string): string {
  return JSON.stringify({
    ok: false,
    error: message
  });
}

export class ToolRegistry {
  private readonly toolsByName: Map<string, ToolDefinition>;

  constructor(tools: ToolDefinition[]) {
    this.toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  }

  list(): ToolDefinition[] {
    return [...this.toolsByName.values()];
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<string> {
    const tool = this.toolsByName.get(name);
    if (!tool) {
      return createToolError(`Unknown tool: ${name}`);
    }

    try {
      return await tool.execute(input, context);
    } catch (error) {
      return createToolError(
        error instanceof Error ? error.message : `Tool execution failed: ${String(error)}`
      );
    }
  }
}

interface CreateDefaultToolRegistryOptions {
  memoryStore: MemoryStore;
  pathAccessPolicy: PathAccessPolicy;
  approvalStore: ApprovalStore;
  shellRunner: ShellRunner;
  appLauncher: AppLauncher;
  browserController: BrowserController;
  desktopController: DesktopController;
  visionClient: VisionClient;
  approvalPolicy: ApprovalPolicy;
  logger: Logger;
}

export function createDefaultToolRegistry(options: CreateDefaultToolRegistryOptions): ToolRegistry {
  return new ToolRegistry([
    createGetCurrentTimeTool(),
    createRememberFactTool(options.memoryStore),
    createRecallMemoryTool(options.memoryStore),
    createRequestExternalReviewTool(options.approvalStore, options.approvalPolicy),
    createSearchWebTool(),
    createFetchWebPageTool(),
    createLaunchAppTool(options.appLauncher),
    createBrowserNavigateTool(options.browserController),
    createBrowserSearchTool(options.browserController),
    createBrowserSnapshotTool(options.browserController),
    createBrowserClickTool(options.browserController),
    createBrowserTypeTool(options.browserController),
    createBrowserScreenshotTool(options.browserController),
    createBrowserCloseTool(options.browserController),
    createListAppsTool(options.desktopController),
    createFocusAppTool(options.desktopController),
    createCloseAppTool(options.desktopController),
    createGetActiveAppTool(options.desktopController),
    createTakeScreenshotTool(options.desktopController),
    createTakeActiveWindowScreenshotTool(options.desktopController),
    createOcrReadTool(options.desktopController, options.visionClient),
    createKeyboardHotkeyTool(options.desktopController),
    createKeyboardTypeTool(options.desktopController),
    createMouseClickTool(options.desktopController),
    createFindElementTool(options.desktopController, options.visionClient),
    createWaitForElementTool(options.desktopController, options.visionClient),
    createClickElementTool(options.desktopController, options.visionClient),
    createClipboardReadTool(options.desktopController),
    createClipboardWriteTool(options.desktopController),
    createResolveKnownFolderTool(options.pathAccessPolicy),
    createListFilesTool(options.pathAccessPolicy),
    createReadFileTool(options.pathAccessPolicy),
    createSearchFilesTool(options.pathAccessPolicy),
    createWriteFileTool(options.pathAccessPolicy),
    createReplaceInFileTool(options.pathAccessPolicy),
    createRunShellCommandTool(
      options.pathAccessPolicy,
      options.approvalStore,
      options.shellRunner,
      options.logger
    )
  ]);
}
