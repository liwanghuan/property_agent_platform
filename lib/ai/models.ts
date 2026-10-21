// Model selection is configuration, not code (SKILL.md §3).
export type ModelTier = "extract" | "fast";

const DEFAULTS: Record<ModelTier, string> = {
  extract: "claude-sonnet-5-5", // extraction, matching rationale
  fast: "claude-haiku-5-5", // copywriting variants, soft compliance review, digest prose
};

const ENV_KEYS: Record<ModelTier, string> = {
  extract: "CLAUDE_MODEL_EXTRACT",
  fast: "CLAUDE_MODEL_FAST",
};

export function modelFor(tier: ModelTier, env: NodeJS.ProcessEnv = process.env): string {
  return env[ENV_KEYS[tier]]?.trim() || DEFAULTS[tier];
}
