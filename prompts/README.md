# Prompts

One file per prompt version: `<task>.v<N>.md` (e.g. `extract_listing.v1.md`).
Load with `loadPrompt(task, N)` from `lib/ai`; the id `<task>.v<N>` is written to `ai_calls.prompt_version`.

Never edit a released version in place. Add `v<N+1>`, point the task function at it, and re-run that task's eval.
