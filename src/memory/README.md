# Memory

Level 2 local memory is implemented in SQLite.

Current direction:
- `core_memory` for durable facts
- `messages` plus FTS5 search for recent recall
- `summaries` for rolling compaction of older chat history
