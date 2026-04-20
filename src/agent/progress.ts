export interface AgentRunOptions {
  taskId?: string;
  onProgress?: (message: string) => Promise<void> | void;
  consumeSteeringMessages?: () => Promise<string[]> | string[];
  shouldCancel?: () => boolean | Promise<boolean>;
}

export const PLANNING_PROGRESS_MESSAGE = "Status: planning the next step";
export const PREPARING_REPLY_PROGRESS_MESSAGE = "Status: preparing the reply";
export const ITERATION_LIMIT_PROGRESS_MESSAGE =
  "Status: reached the local step limit before finishing";
export const LOCAL_ERROR_PROGRESS_MESSAGE = "Status: hit a local error while working";
export const STEERING_PROGRESS_MESSAGE = "Status: updating the plan with your latest guidance";
export const CANCELLATION_PROGRESS_MESSAGE =
  "Status: cancellation requested; stopping after the current step";

function clipText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 3, 1)).trimEnd()}...`;
}

function quoteValue(value: string, maxLength = 80): string {
  return `"${clipText(value.replace(/"/g, "'"), maxLength)}"`;
}

function readString(
  source: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = source?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readBoolean(
  source: Record<string, unknown> | undefined,
  key: string
): boolean | undefined {
  const value = source?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function readArrayLength(source: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = source?.[key];
  return Array.isArray(value) ? value.length : undefined;
}

function formatFailureStatus(
  fallbackMessage: string,
  rawError: string | undefined
): string {
  const error = rawError ? clipText(rawError, 80) : undefined;
  return error ? `${fallbackMessage}: ${error}` : fallbackMessage;
}

function parseToolResult(rawResult: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(rawResult) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isToolSuccess(result: Record<string, unknown> | undefined): boolean {
  return readBoolean(result, "ok") !== false;
}

function formatCount(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

function humanizeToolName(toolName: string): string {
  return toolName.replace(/_/g, " ");
}

export function formatTaskStartedProgressMessage(userInput: string): string {
  return `Status: proceeding with ${quoteValue(userInput, 90)}`;
}

export function formatToolStartProgressMessage(
  toolName: string,
  input: Record<string, unknown>
): string {
  const appName = readString(input, "app_name");
  const path = readString(input, "path");
  const query = readString(input, "query");
  const keys = readString(input, "keys");
  const folder = readString(input, "folder");

  switch (toolName) {
    case "launch_app":
      return appName
        ? `Status: opening ${quoteValue(appName, 50)}`
        : "Status: opening an app";
    case "focus_app":
      return appName
        ? `Status: focusing ${quoteValue(appName, 50)}`
        : "Status: focusing an app";
    case "close_app":
      return appName
        ? `Status: closing ${quoteValue(appName, 50)}`
        : "Status: closing an app";
    case "list_apps":
      return query
        ? `Status: checking apps matching ${quoteValue(query, 60)}`
        : "Status: checking running apps";
    case "take_screenshot":
      return "Status: taking a screenshot";
    case "take_active_window_screenshot":
      return "Status: taking a screenshot of the active window";
    case "ocr_read":
      return "Status: reading text from the screen";
    case "find_element":
      return query
        ? `Status: looking for ${quoteValue(query, 60)} on screen`
        : "Status: looking for something on screen";
    case "wait_for_element":
      return query
        ? `Status: waiting for ${quoteValue(query, 60)} to appear`
        : "Status: waiting for an element to appear";
    case "click_element":
      return query
        ? `Status: clicking ${quoteValue(query, 60)}`
        : "Status: clicking a visible element";
    case "get_active_app":
      return "Status: checking the active app";
    case "keyboard_hotkey":
      return keys
        ? `Status: sending ${quoteValue(keys, 40)}`
        : "Status: sending a keyboard shortcut";
    case "keyboard_type":
      return "Status: typing in the active app";
    case "mouse_click":
      return "Status: clicking on screen";
    case "list_files":
      return path
        ? `Status: checking files in ${quoteValue(path, 70)}`
        : "Status: checking files in the workspace";
    case "read_file":
      return path
        ? `Status: reading ${quoteValue(path, 70)}`
        : "Status: reading a file";
    case "search_files":
      return query
        ? `Status: searching files for ${quoteValue(query, 60)}`
        : "Status: searching files";
    case "write_file":
      return path
        ? `Status: writing ${quoteValue(path, 70)}`
        : "Status: writing a file";
    case "replace_in_file":
      return path
        ? `Status: editing ${quoteValue(path, 70)}`
        : "Status: editing a file";
    case "clipboard_read":
      return "Status: reading the clipboard";
    case "clipboard_write":
      return "Status: updating the clipboard";
    case "resolve_known_folder":
      return folder
        ? `Status: resolving ${quoteValue(folder, 40)}`
        : "Status: resolving a common folder";
    case "run_shell_command":
      return "Status: running a local shell command";
    case "request_external_review":
      return "Status: preparing an action for your review";
    case "get_current_time":
      return "Status: checking the current time";
    case "remember_fact":
      return "Status: saving that detail for later";
    case "recall_memory":
      return "Status: checking stored memory";
    default:
      return `Status: running ${humanizeToolName(toolName)}`;
  }
}

export function formatToolFinishedProgressMessage(
  toolName: string,
  input: Record<string, unknown>,
  rawResult: string
): string {
  const result = parseToolResult(rawResult);
  const ok = isToolSuccess(result);
  const inputAppName = readString(input, "app_name");
  const inputPath = readString(input, "path");
  const inputQuery = readString(input, "query");
  const inputFolder = readString(input, "folder");
  const matchedApp = readString(result, "matchedApp") ?? readString(result, "matchedName") ?? inputAppName;
  const error = readString(result, "error") ?? readString(result, "accessError");

  switch (toolName) {
    case "launch_app":
      return ok
        ? matchedApp
          ? `Status: opened ${quoteValue(matchedApp, 50)}`
          : "Status: opened the app"
        : inputAppName
          ? `Status: could not open ${quoteValue(inputAppName, 50)}`
          : "Status: could not open the app";
    case "focus_app":
      return ok
        ? matchedApp
          ? `Status: focused ${quoteValue(matchedApp, 50)}`
          : "Status: focused the app"
        : inputAppName
          ? `Status: could not focus ${quoteValue(inputAppName, 50)}`
          : "Status: could not focus the app";
    case "close_app":
      return ok
        ? matchedApp
          ? `Status: closed ${quoteValue(matchedApp, 50)}`
          : "Status: closed the app"
        : inputAppName
          ? `Status: could not close ${quoteValue(inputAppName, 50)}`
          : "Status: could not close the app";
    case "list_apps":
      return "Status: checked the app list";
    case "take_screenshot":
      return ok ? "Status: captured a screenshot" : "Status: could not capture the screenshot";
    case "take_active_window_screenshot":
      return ok
        ? "Status: captured the active window"
        : "Status: could not capture the active window";
    case "ocr_read":
      return ok
        ? "Status: read the text from the screen"
        : "Status: could not read the text from the screen";
    case "find_element": {
      const found = readBoolean(result, "found");
      const label = readString(result, "label") ?? inputQuery;
      if (found) {
        return label
          ? `Status: found ${quoteValue(label, 60)} on screen`
          : "Status: found the element on screen";
      }

      return inputQuery
        ? `Status: could not find ${quoteValue(inputQuery, 60)} on screen`
        : "Status: could not find the element on screen";
    }
    case "wait_for_element": {
      const found = readBoolean(result, "found");
      const label = readString(result, "label") ?? inputQuery;
      if (found) {
        return label
          ? `Status: detected ${quoteValue(label, 60)}`
          : "Status: detected the element";
      }

      return inputQuery
        ? `Status: timed out waiting for ${quoteValue(inputQuery, 60)}`
        : "Status: timed out waiting for the element";
    }
    case "click_element": {
      const found = readBoolean(result, "found");
      const label = readString(result, "label") ?? inputQuery;
      if (found) {
        return label
          ? `Status: clicked ${quoteValue(label, 60)}`
          : "Status: clicked the element";
      }

      return inputQuery
        ? `Status: could not click ${quoteValue(inputQuery, 60)}`
        : "Status: could not click the element";
    }
    case "get_active_app":
      return ok ? "Status: checked the active app" : "Status: could not check the active app";
    case "keyboard_hotkey":
      return ok ? "Status: sent the keyboard shortcut" : "Status: could not send the keyboard shortcut";
    case "keyboard_type":
      return ok ? "Status: finished typing in the active app" : "Status: could not type in the active app";
    case "mouse_click":
      return ok ? "Status: clicked on screen" : "Status: could not click on screen";
    case "list_files": {
      if (!ok) {
        return formatFailureStatus(
          inputPath
            ? `Status: could not check ${quoteValue(inputPath, 70)}`
            : "Status: could not check the files",
          error
        );
      }

      const entryCount = readArrayLength(result, "entries");
      if (typeof entryCount === "number") {
        return `Status: found ${formatCount(entryCount, "file entry", "file entries")}`;
      }

      return "Status: checked the files";
    }
    case "read_file": {
      if (!ok) {
        return formatFailureStatus(
          inputPath
            ? `Status: could not read ${quoteValue(inputPath, 70)}`
            : "Status: could not read the file",
          error
        );
      }

      const path = readString(result, "path") ?? inputPath;
      return path
        ? `Status: finished reading ${quoteValue(path, 70)}`
        : "Status: finished reading the file";
    }
    case "search_files": {
      if (!ok) {
        return formatFailureStatus(
          inputQuery
            ? `Status: could not search files for ${quoteValue(inputQuery, 60)}`
            : "Status: could not search the files",
          error
        );
      }

      const matchCount = readArrayLength(result, "matches");
      const query = readString(result, "query") ?? inputQuery;
      if (typeof matchCount === "number" && query) {
        return `Status: found ${formatCount(matchCount, "file match", "file matches")} for ${quoteValue(query, 60)}`;
      }

      if (typeof matchCount === "number") {
        return `Status: found ${formatCount(matchCount, "file match", "file matches")}`;
      }

      return query
        ? `Status: finished searching files for ${quoteValue(query, 60)}`
        : "Status: finished searching files";
    }
    case "write_file": {
      const path = readString(result, "path") ?? inputPath;
      return ok
        ? path
          ? `Status: wrote ${quoteValue(path, 70)}`
          : "Status: wrote the file"
        : path
          ? `Status: could not write ${quoteValue(path, 70)}`
          : "Status: could not write the file";
    }
    case "replace_in_file": {
      const path = readString(result, "path") ?? inputPath;
      return ok
        ? path
          ? `Status: updated ${quoteValue(path, 70)}`
          : "Status: updated the file"
        : path
          ? `Status: could not update ${quoteValue(path, 70)}`
          : "Status: could not update the file";
    }
    case "clipboard_read":
      return ok ? "Status: read the clipboard" : "Status: could not read the clipboard";
    case "clipboard_write":
      return ok ? "Status: updated the clipboard" : "Status: could not update the clipboard";
    case "resolve_known_folder": {
      const folder = readString(result, "folder") ?? inputFolder;
      const resolvedPath = readString(result, "displayPath") ?? readString(result, "path");

      if (!ok) {
        return formatFailureStatus(
          folder
            ? `Status: could not resolve ${quoteValue(folder, 40)}`
            : "Status: could not resolve the folder",
          error
        );
      }

      if (folder && resolvedPath) {
        return `Status: resolved ${quoteValue(folder, 40)} to ${quoteValue(resolvedPath, 60)}`;
      }

      return "Status: resolved the folder";
    }
    case "run_shell_command":
      if (readBoolean(result, "approvalRequired")) {
        return "Status: a shell command needs approval";
      }

      return ok
        ? "Status: finished the local shell command"
        : "Status: the local shell command reported an issue";
    case "request_external_review":
      if (readBoolean(result, "approvalRequired")) {
        return "Status: an external action is waiting for approval";
      }

      return ok
        ? "Status: the external action was already approved"
        : "Status: could not prepare the external action review";
    case "get_current_time":
      return ok ? "Status: checked the current time" : "Status: could not check the current time";
    case "remember_fact":
      return ok ? "Status: saved that detail for later" : "Status: could not save that detail";
    case "recall_memory":
      return ok ? "Status: checked stored memory" : "Status: could not check stored memory";
    default:
      return ok
        ? `Status: finished ${humanizeToolName(toolName)}`
        : `Status: hit an issue while running ${humanizeToolName(toolName)}`;
  }
}
