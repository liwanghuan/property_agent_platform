import Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AiCallLogEntry } from "./log";
import { modelFor } from "./models";
import { loadPrompt, renderPrompt } from "./prompts";
import { AiTaskError, runStructured, type StructuredDeps } from "./structured";

const promptsDir = mkdtempSync(path.join(tmpdir(), "prompts-"));
writeFileSync(path.join(promptsDir, "demo_task.v2.md"), "Extract the price from {{source}}.\n");
const prompt = loadPrompt("demo_task", 2, promptsDir);

const Schema = z.object({ price: z.number().positive() });

function response(parsed: unknown, overrides: Record<string, unknown> = {}) {
  return {
    stop_reason: "end_turn",
    stop_details: null,
    parsed_output: parsed,
    usage: { input_tokens: 100, output_tokens: 20 },
    ...overrides,
  };
}

function deps(...results: unknown[]) {
  const logs: AiCallLogEntry[] = [];
  const parse = vi.fn();
  for (const r of results) {
    if (r instanceof Error) parse.mockRejectedValueOnce(r);
    else parse.mockResolvedValueOnce(r);
  }
  let t = 1_000;
  const d: StructuredDeps = {
    client: { beta: { messages: { parse } } } as unknown as StructuredDeps["client"],
    log: async (e) => void logs.push(e),
    now: () => (t += 50),
  };
  return { d, parse, logs };
}

const request = { task: "demo_task", prompt, tier: "extract" as const, schema: Schema, content: "asking 3.2m", agentId: "agent-1" };

describe("prompts", () => {
  it("loads versioned prompt files and renders placeholders", () => {
    expect(prompt.id).toBe("demo_task.v2");
    expect(renderPrompt(prompt, { source: "the chat" })).toBe("Extract the price from the chat.");
    expect(() => renderPrompt(prompt, {})).toThrow(/missing a value/);
  });

  it("rejects path-like task names", () => {
    expect(() => loadPrompt("../secrets", 1, promptsDir)).toThrow(/invalid prompt/);
  });
});

describe("modelFor", () => {
  it("routes tiers from env with defaults", () => {
    expect(modelFor("extract", {} as NodeJS.ProcessEnv)).toBe("claude-sonnet-5-5");
    expect(modelFor("fast", {} as NodeJS.ProcessEnv)).toBe("claude-haiku-5-5");
    expect(modelFor("fast", { CLAUDE_MODEL_FAST: "claude-test" } as unknown as NodeJS.ProcessEnv)).toBe("claude-test");
  });
});

describe("runStructured", () => {
  it("returns validated output and logs one ai_calls entry", async () => {
    const { d, parse, logs } = deps(response({ price: 3_200_000 }));
    await expect(runStructured(request, d)).resolves.toEqual({ price: 3_200_000 });

    const params = parse.mock.calls[0][0];
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.system).toBe(prompt.text);
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.output_config.format).toBeDefined();

    expect(logs).toEqual([
      expect.objectContaining({
        task: "demo_task",
        promptVersion: "demo_task.v2",
        model: "claude-sonnet-5-5",
        agentId: "agent-1",
        inputTokens: 100,
        outputTokens: 20,
        attempts: 1,
        status: "ok",
        latencyMs: 50,
      }),
    ]);
  });

  it("retries once with the validation error, then succeeds", async () => {
    const { d, parse, logs } = deps(response({ price: -1 }), response({ price: 5 }));
    await expect(runStructured(request, d)).resolves.toEqual({ price: 5 });

    const retryContent = parse.mock.calls[1][0].messages[0].content;
    expect(retryContent.at(-1).text).toMatch(/previous output was rejected/);
    expect(logs[0]).toMatchObject({ attempts: 2, status: "ok", inputTokens: 200, outputTokens: 40 });
  });

  it("fails clearly after two invalid outputs", async () => {
    const { d, logs } = deps(response({ price: "abc" }), response(null));
    await expect(runStructured(request, d)).rejects.toMatchObject({ status: "invalid_output" });
    expect(logs[0]).toMatchObject({ attempts: 2, status: "invalid_output" });
  });

  it("treats truncated output as invalid and retries", async () => {
    const { d } = deps(response(null, { stop_reason: "max_tokens" }), response({ price: 7 }));
    await expect(runStructured(request, d)).resolves.toEqual({ price: 7 });
  });

  it("surfaces refusals without retrying", async () => {
    const { d, parse, logs } = deps(
      response(null, { stop_reason: "refusal", stop_details: { type: "refusal", category: "general_harms" } }),
    );
    const err = await runStructured(request, d).catch((e) => e);
    expect(err).toBeInstanceOf(AiTaskError);
    expect(err.status).toBe("refused");
    expect(parse).toHaveBeenCalledTimes(1);
    expect(logs[0]).toMatchObject({ status: "refused", error: "refusal (general_harms)" });
  });

  it("logs and rethrows API errors (transport retries are the SDK's job)", async () => {
    const apiError = new Anthropic.RateLimitError(429, { type: "error" }, "rate limited", new Headers());
    const { d, parse, logs } = deps(apiError);
    await expect(runStructured(request, d)).rejects.toMatchObject({ status: "error" });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(logs[0]).toMatchObject({ status: "error" });
  });

  it("retries when the SDK cannot parse the model's JSON", async () => {
    const { d } = deps(new SyntaxError("Unexpected token"), response({ price: 9 }));
    await expect(runStructured(request, d)).resolves.toEqual({ price: 9 });
  });
});
