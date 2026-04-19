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
6. Install dependencies:

```bash
npm install
```

## Run

```bash
npm run dev
```

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
