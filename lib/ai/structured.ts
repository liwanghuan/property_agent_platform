// Structured-output helper: every stored AI result goes through here (SKILL.md §7).
// - JSON schema output via the SDK's zod helper, validated again with zod
// - transport retries with backoff are handled by the SDK client (maxRetries)
// - on invalid output, retry once with the validation error, then fail clearly
// - every invocation is logged to ai_calls
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import { logToSupabase, type AiCallLogEntry, type AiCallLogger } from "./log";
import { modelFor, type ModelTier } from "./models";
import type { Prompt } from "./prompts";

// Server-side refusal fallback: the API re-runs a policy-declined request on its recommended
// fallback model. Models without fallback support simply run alone.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type AiFailure = Exclude<AiCallLogEntry["status"], "ok">;

export class AiTaskError extends Error {
  constructor(
    readonly task: string,
    readonly status: AiFailure,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`[${task}] ${message}`, options);
    this.name = "AiTaskError";
  }
}

export interface StructuredRequest<S extends z.ZodType> {
  task: string;
  prompt: Prompt;
  /** Rendered system prompt; defaults to prompt.text. */
  system?: string;
  tier: ModelTier;
  schema: S;
  /** Only what the task needs (SKILL.md §2 principle 6). */
  content: string | BetaContentBlockParam[];
  agentId?: string | null;
  maxTokens?: number;
}

type ParseClient = { beta: { messages: { parse: Anthropic["beta"]["messages"]["parse"] } } };

export interface StructuredDeps {
  client: ParseClient;
  log: AiCallLogger;
  now: () => number;
}

let defaultClient: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  // Credentials resolve from the environment (ANTHROPIC_API_KEY or an `ant auth` profile).
  defaultClient ??= new Anthropic({ maxRetries: 3 });
  return defaultClient;
}

const defaultDeps = (): StructuredDeps => ({
  client: getAnthropicClient(),
  log: logToSupabase,
  now: Date.now,
});

export async function runStructured<S extends z.ZodType>(
  req: StructuredRequest<S>,
  deps: StructuredDeps = defaultDeps(),
): Promise<z.infer<S>> {
  const model = modelFor(req.tier);
  const started = deps.now();
  const userContent: BetaContentBlockParam[] =
    typeof req.content === "string" ? [{ type: "text", text: req.content }] : req.content;

  let inputTokens = 0;
  let outputTokens = 0;
  let attempts = 0;
  let lastProblem = "";

  const finish = async (status: AiCallLogEntry["status"], error?: string) =>
    deps.log({
      task: req.task,
      promptVersion: req.prompt.id,
      model,
      agentId: req.agentId ?? null,
      inputTokens,
      outputTokens,
      latencyMs: deps.now() - started,
      attempts,
      status,
      error,
    });

  while (attempts < 2) {
    attempts += 1;
    const content: BetaContentBlockParam[] = lastProblem
      ? [
          ...userContent,
          {
            type: "text",
            text: `Your previous output was rejected: ${lastProblem}\nReturn output that satisfies the schema exactly.`,
          },
        ]
      : userContent;

    let response;
    try {
      response = await deps.client.beta.messages.parse({
        model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system ?? req.prompt.text,
        messages: [{ role: "user", content }],
        output_config: { format: betaZodOutputFormat(req.schema) },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        // Already retried with backoff by the SDK; let the job runner decide what's next.
        await finish("error", `${error.status ?? "connection"}: ${error.message}`);
        throw new AiTaskError(req.task, "error", error.message, { cause: error });
      }
      // The SDK could not parse the model's JSON — treat as invalid output and retry once.
      lastProblem = error instanceof Error ? error.message : String(error);
      continue;
    }

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.category ?? "unspecified";
      await finish("refused", `refusal (${category})`);
      throw new AiTaskError(req.task, "refused", `model declined the request (${category})`);
    }
    if (response.stop_reason === "max_tokens") {
      lastProblem = "the output was cut off at the token limit; be more concise";
      continue;
    }

    const checked = req.schema.safeParse(response.parsed_output);
    if (checked.success) {
      await finish("ok");
      return checked.data;
    }
    lastProblem = checked.error.message;
  }

  await finish("invalid_output", lastProblem);
  throw new AiTaskError(req.task, "invalid_output", `output failed validation twice: ${lastProblem}`);
}
