# Gravity Claw

Level 1 foundation for a local-first Telegram AI agent.

## What Level 1 includes

- Telegram bot via `grammy` long polling
- Local Ollama inference only
- A bounded tool loop
- One built-in tool: `get_current_time`
- Telegram user ID allowlist

## What Level 1 does not include

- Web server or webhooks
- Persistent memory
- Voice
- MCP integrations
- Shell, file, or network tools

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
4. Install dependencies:

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
- Level 1 accepts text messages only.
- Small local models can miss tool calls or need simpler prompts. This is expected at this stage.
