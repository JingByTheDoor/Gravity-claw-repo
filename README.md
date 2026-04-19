# Gravity Claw

Level 4 tools-ready foundation for a local-first Telegram AI agent.

## What is included

- Telegram bot via `grammy` long polling
- Local Ollama inference only
- A bounded tool loop
- Local SQLite memory with recent context, durable facts, and rolling summaries
- Built-in tools:
  - `get_current_time`
  - `remember_fact`
  - `recall_memory`
  - `list_files`
  - `read_file`
  - `search_files`
  - `run_shell_command`
- Telegram user ID allowlist

## What is still not included

- Web server or webhooks
- Voice
- MCP integrations

## Requirements

- Node.js 22+
- Ollama running locally at `http://127.0.0.1:11434`
- A pulled model, default `qwen2.5:3b`
- Telegram bot token from BotFather
- Your Telegram numeric user ID

## Setup

1. Copy `.env.example` to `.env`
2. Fill in `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_ID`
3. Make sure Ollama is running and the configured model exists
4. Optional: change `DATABASE_PATH` if you do not want `gravity-claw.db` in the repo root
5. Optional: set `WORKSPACE_ROOT` if the agent should inspect a different local folder
6. Optional: set `TOOL_ALLOWED_ROOTS` if the agent should read or use shell cwd in additional local folders outside the default workspace root
6. Install dependencies:

```bash
npm install
```

## Run

```bash
npm run dev
```

For a long-running local bot, use production mode instead of `npm run dev`. This repo now includes Windows helpers so you can start it without keeping a terminal open:

- Double-click `start-bot.cmd` to build the app and start the bot in the background.
- Double-click `stop-bot.cmd` to stop the background bot.
- Double-click `install-bot-autostart.cmd` to register a Windows Scheduled Task that starts the bot automatically when you log in.
- Double-click `remove-bot-autostart.cmd` to remove that Scheduled Task.
- Double-click `install-ollama-autostart.cmd` to register a Windows Scheduled Task that starts Ollama automatically when you log in.
- Double-click `remove-ollama-autostart.cmd` to remove the Ollama auto-start task.

Background logs are written to `logs/bot.out.log` and `logs/bot.err.log`. The running process ID is stored in `.runtime/bot.pid`.

Important:

- `npm run dev` is for development only. It uses `tsx watch`, keeps a terminal attached, and restarts on file changes.
- The background scripts build the project and then run `node dist/src/index.js`, which matches the `npm start` production path.
- Ollama still has to be running locally. If Ollama is not up when the bot starts, the bot exits during bootstrap.
- The Ollama helper installs a task that runs `ollama serve` at logon, which is the local API server your bot talks to.

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

- Unauthorized Telegram users are ignored silently.
- The bot accepts text messages only.
- Small local models can miss tool calls or need simpler prompts. This is expected at this stage.
- Conversation memory is stored locally in SQLite and kept on your machine.
- Use `/new` in Telegram to start a fresh chat session while keeping durable memory facts.
- Use `/approve <id>` or `/deny <id>` for shell commands that require confirmation.
- Read-only shell commands may run immediately; mutating or unclear commands require approval first.
- By default, file tools stay in `WORKSPACE_ROOT`. Add `TOOL_ALLOWED_ROOTS` in `.env` to let the bot inspect extra trusted folders with absolute paths.
