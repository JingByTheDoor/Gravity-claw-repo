# Gravity Claw

Level 4 tools-ready foundation for a local-first Telegram AI agent.

## What is included

- Telegram bot via `grammy` long polling
- Local Ollama inference only
- Optional fast-first model routing with escalation to a stronger local model
- A bounded tool loop
- Configurable Ollama sampling defaults and optional Gemma 4 thinking mode
- Local SQLite memory with recent context, durable facts, and rolling summaries
- Built-in tools:
  - `get_current_time`
  - `remember_fact`
  - `recall_memory`
  - `launch_app`
  - `browser_navigate`
  - `browser_snapshot`
  - `browser_click`
  - `browser_type`
  - `browser_screenshot`
  - `browser_close`
  - `list_apps`
  - `focus_app`
  - `close_app`
  - `get_active_app`
  - `take_screenshot`
  - `take_active_window_screenshot`
  - `ocr_read`
  - `keyboard_hotkey`
  - `keyboard_type`
  - `mouse_click`
  - `find_element`
  - `wait_for_element`
  - `click_element`
  - `clipboard_read`
  - `clipboard_write`
  - `resolve_known_folder`
  - `list_files`
  - `read_file`
  - `search_files`
- `write_file`
- `replace_in_file`
- `run_shell_command`
- Telegram user ID allowlist plus private-chat-only authorization

## What is still not included

- Web server or webhooks
- Voice
- MCP integrations

## Requirements

- Node.js 22+
- Ollama running locally at `http://127.0.0.1:11434`
- A pulled primary model, default `qwen2.5:3b`
- Optional pulled fast model for first-pass routing, for example `qwen2.5:1.5b`
- Optional pulled vision-capable model for OCR and element finding, for example `gemma4:latest`
- Telegram bot token from BotFather
- Your Telegram numeric user ID

## Setup

1. Copy `.env.example` to `.env`
2. Fill in `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_ID`
   The bot only answers that user in a private chat. Optionally set `TELEGRAM_ALLOWED_CHAT_IDS` to pin it to specific approved private chat IDs.
3. Make sure Ollama is running and the configured model exists
4. Optional: set `OLLAMA_FAST_MODEL` to a smaller local model if you want every task to hit a fast router first and escalate harder requests to `OLLAMA_MODEL`
5. Optional: set `OLLAMA_VISION_MODEL` to a multimodal local model if you want reliable OCR and element-finding results. If unset, it falls back to `OLLAMA_MODEL`.
6. Optional: tune Ollama sampling with `OLLAMA_TEMPERATURE`, `OLLAMA_TOP_P`, and `OLLAMA_TOP_K`. The example env now defaults these to the Gemma 4 recommendations from Ollama's Gemma 4 model page.
7. Optional: set `OLLAMA_ENABLE_THINKING=true` if you want the system prompt to start with `<|think|>` for Gemma 4 style thinking mode.
8. Optional: set `OLLAMA_VISION_TOKEN_BUDGET` to `70`, `140`, `280`, `560`, or `1120` if your local Ollama Gemma 4 setup supports per-request visual token budgets. Higher values are better for OCR and small text.
9. Optional: change `DATABASE_PATH` if you do not want `gravity-claw.db` in the repo root
10. Optional: set `WORKSPACE_ROOT` if the agent should inspect a different local folder
11. Optional: set `TOOL_ALLOWED_ROOTS` if the agent should read or use shell cwd in additional local folders outside the default workspace root
12. Install dependencies:

```bash
npm install
```

10. If Playwright does not find a browser on this machine, install Chromium once:

```bash
npm run install:browser
```

## Run

```bash
npm run dev
```

For a long-running local bot, use production mode instead of `npm run dev`. This repo now includes Windows helpers so you can start it without keeping a terminal open:

- Double-click `start-bot.cmd` to build the app and start the bot in the background.
- Double-click `stop-bot.cmd` to stop the background bot.
- Double-click `install-bot-autostart.cmd` to set up Windows auto-start for the bot when you log in.
- Double-click `remove-bot-autostart.cmd` to remove that bot auto-start setup.
- Double-click `install-ollama-autostart.cmd` to set up Windows auto-start for Ollama when you log in.
- Double-click `remove-ollama-autostart.cmd` to remove the Ollama auto-start setup.

The supervisor log is `logs/bot-supervisor.log`. Each bot run now writes to its own files under `logs/runs/`. The current run log paths are tracked in `.runtime/bot-run.json`. The running process IDs are stored in `.runtime/bot-supervisor.pid` and `.runtime/bot.pid`.

Important:

- `npm run dev` is for development only. It uses `tsx watch`, keeps a terminal attached, and restarts on file changes.
- The background start script now launches a small supervisor process. That supervisor builds the project, runs `node dist/src/index.js`, and watches for local file changes.
- If you edit files in `src`, `.env`, `package.json`, `package-lock.json`, `tsconfig.json`, or update the repo with `git pull`, the supervisor rebuilds and restarts the bot automatically after the files change locally.
- If the build fails after an edit, the supervisor logs the failure and keeps the last working bot process running.
- The start helper prints the current bot stdout and stderr log paths from `.runtime/bot-run.json`.
- If `package.json` or `package-lock.json` changed and you installed dependencies manually with `npm install`, the supervisor sees the updated local files and redeploys automatically.
- Ollama still has to be running locally. If Ollama is not up when the bot starts, the bot exits during bootstrap.
- The Ollama helper installs a task that runs `ollama serve` at logon, which is the local API server your bot talks to.
- If Windows blocks Scheduled Task creation on your account, the install scripts fall back to a Startup folder entry for the same logon auto-start behavior.

## If the computer is off

This project currently uses Telegram long polling and a local Ollama model. That means the bot only works while some machine is actually running the Node process and the model:

- If this exact PC is shut down, the bot is off. There is no way for a powered-off computer to keep polling Telegram.
- A Scheduled Task only helps when the machine is on and you log in again.
- To keep the bot available 24/7, move it to an always-on machine such as a mini PC, a second desktop, a home server, or a cloud VM.
- If you keep using local Ollama, that always-on machine must also host Ollama and the model files.
- If you switch to a hosted model API instead of local Ollama, then only the bot process itself needs to stay online.
- A future webhook version could also work from a server, but webhooks still require an always-on machine that Telegram can reach over HTTPS. Webhooks do not remove the need for a running computer; they just change how Telegram delivers updates.

## Verify

```bash
npm test
npm run typecheck
npm run build
```

## Notes

- Unauthorized Telegram users and non-private or unauthorized private chats are ignored silently.
- The bot accepts text messages only.
- Small local models can miss tool calls or need simpler prompts. This is expected at this stage.
- If `OLLAMA_FAST_MODEL` is set, the fast model sees each task first, keeps easy tasks for itself, and rewrites/escalates harder ones to `OLLAMA_MODEL`.
- If `OLLAMA_VISION_MODEL` is set, OCR and element-finding use that model. If it is unset, they fall back to `OLLAMA_MODEL`.
- Assistant thought blocks are stripped from saved conversation history before future turns are replayed, which keeps Gemma 4 multi-turn conversations aligned with Ollama's guidance.
- OCR and element-finding work best with a multimodal model. A text-only chat model may pass health checks for chat and still perform poorly for vision tasks.
- Conversation memory is stored locally in SQLite and kept on your machine.
- Pending shell approvals and `/last_error` now survive bot restarts because they are stored in the local SQLite database.
- Use `/new` in Telegram to start a fresh chat session while keeping durable memory facts.
- Use `/help` for commands and example prompts.
- Use `/status` to inspect local bot, model, and workspace status.
- Use `/approvals` to list pending shell approvals.
- Use `/cancel` to request cancellation of the current task.
- Use `/approve <id>` or `/deny <id>` for shell commands that require confirmation.
- All shell commands require approval first. Path validation still blocks commands that target paths outside the trusted local roots.
- By default, file tools stay in `WORKSPACE_ROOT`. Add `TOOL_ALLOWED_ROOTS` in `.env` to let the bot inspect extra trusted folders with absolute paths.
- On Windows, common folders like Downloads or Documents can be redirected outside `C:\Users\<name>`. If that happens, add the redirected path itself to `TOOL_ALLOWED_ROOTS`.
- Screenshots are saved under `artifacts/screenshots/` by default.
- Browser tools keep a separate Playwright session per Telegram chat until `browser_close` resets that chat's browser state.
