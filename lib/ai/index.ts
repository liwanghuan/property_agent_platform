// The only entry point for model calls. Feature code calls task-level functions
// (extractListing, generateCopy, reviewCompliance, summarizeDigest) that are added here as
// each milestone lands; they are built on runStructured and never touch the SDK directly.
export { AiTaskError, runStructured, type StructuredRequest } from "./structured";
export { loadPrompt, renderPrompt, type Prompt } from "./prompts";
export { modelFor, type ModelTier } from "./models";
