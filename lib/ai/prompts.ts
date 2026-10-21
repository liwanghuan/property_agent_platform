// Prompts live in /prompts/<task>.v<N>.md; the "<task>.v<N>" id is logged with every call
// (SKILL.md §7). Changing a prompt means adding a new version file and re-running its eval.
import { readFileSync } from "node:fs";
import path from "node:path";

export interface Prompt {
  task: string;
  version: number;
  /** e.g. "extract_listing.v1" — stored in ai_calls.prompt_version */
  id: string;
  text: string;
}

const PROMPTS_DIR = path.join(process.cwd(), "prompts");

export function loadPrompt(task: string, version: number, dir: string = PROMPTS_DIR): Prompt {
  if (!/^[a-z][a-z0-9_]*$/.test(task) || !Number.isInteger(version) || version < 1) {
    throw new Error(`invalid prompt reference ${task}.v${version}`);
  }
  const id = `${task}.v${version}`;
  const text = readFileSync(path.join(dir, `${id}.md`), "utf8").trim();
  return { task, version, id, text };
}

/** Replaces {{name}} placeholders; throws on any placeholder left unfilled. */
export function renderPrompt(prompt: Prompt, vars: Record<string, string>): string {
  const out = prompt.text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) =>
    key in vars ? vars[key] : match,
  );
  const missing = out.match(/\{\{\s*[a-z_]+\s*\}\}/i);
  if (missing) throw new Error(`prompt ${prompt.id} is missing a value for ${missing[0]}`);
  return out;
}
