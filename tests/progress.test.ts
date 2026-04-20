import { describe, expect, it } from "vitest";
import { formatToolFinishedProgressMessage } from "../src/agent/progress.js";

describe("progress formatting", () => {
  it("surfaces list_files failures instead of reporting success", () => {
    const message = formatToolFinishedProgressMessage(
      "list_files",
      { path: "/Downloads" },
      JSON.stringify({
        ok: false,
        error: "Path is outside the allowed local roots."
      })
    );

    expect(message).toBe(
      'Status: could not check "/Downloads": Path is outside the allowed local roots.'
    );
  });

  it("surfaces read_file failures instead of reporting success", () => {
    const message = formatToolFinishedProgressMessage(
      "read_file",
      { path: "notes/missing.txt" },
      JSON.stringify({
        ok: false,
        error: "Path does not exist."
      })
    );

    expect(message).toBe('Status: could not read "notes/missing.txt": Path does not exist.');
  });

  it("surfaces search_files failures instead of reporting success", () => {
    const message = formatToolFinishedProgressMessage(
      "search_files",
      { query: "orange" },
      JSON.stringify({
        ok: false,
        error: "Path is not a directory."
      })
    );

    expect(message).toBe('Status: could not search files for "orange": Path is not a directory.');
  });
});
