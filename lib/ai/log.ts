import { createAdminClient, hasServiceRole } from "../supabase/admin";

export interface AiCallLogEntry {
  task: string;
  promptVersion: string;
  model: string;
  agentId: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  attempts: number;
  status: "ok" | "invalid_output" | "refused" | "error";
  error?: string;
}

export type AiCallLogger = (entry: AiCallLogEntry) => Promise<void>;

/** Writes to public.ai_calls with the service role. Logging failures never fail the task. */
export const logToSupabase: AiCallLogger = async (entry) => {
  if (!hasServiceRole()) {
    console.warn("[ai] ai_calls not logged: Supabase service role not configured", entry.task);
    return;
  }
  const { error } = await createAdminClient()
    .from("ai_calls")
    .insert({
      task: entry.task,
      prompt_version: entry.promptVersion,
      model: entry.model,
      agent_id: entry.agentId,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      latency_ms: entry.latencyMs,
      attempts: entry.attempts,
      status: entry.status,
      error: entry.error?.slice(0, 2000) ?? null,
    });
  if (error) console.error("[ai] failed to write ai_calls", error.message);
};
