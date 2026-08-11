import type { Platform, VerificationInput } from "./types.js";

export const MAX_QUESTION_CHARS = 6_000;
export const MAX_ANSWER_CHARS = 12_000;
export const MAX_INTENTS = 8;
export const MAX_INTENT_CHARS = 1_000;
export const MAX_TOTAL_INTENT_CHARS = 4_000;

export class InputError extends Error {}

function clean(value: string, max: number, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new InputError(`${label} cannot be empty.`);
  if (normalized.length > max) {
    throw new InputError(`${label} is too long (${normalized.length}/${max} characters).`);
  }
  return normalized;
}

export function normalizeInput(input: VerificationInput): VerificationInput {
  const intents = (input.intents ?? [])
    .map((intent) => intent.trim())
    .filter(Boolean)
    .slice(0, MAX_INTENTS);
  for (const intent of intents) {
    if (intent.length > MAX_INTENT_CHARS) {
      throw new InputError(`Each intent must be ${MAX_INTENT_CHARS} characters or fewer.`);
    }
  }
  if (intents.reduce((total, intent) => total + intent.length, 0) > MAX_TOTAL_INTENT_CHARS) {
    throw new InputError(`Intents exceed the ${MAX_TOTAL_INTENT_CHARS}-character total limit.`);
  }

  return {
    platform: input.platform,
    question: clean(input.question, MAX_QUESTION_CHARS, "Question"),
    answer: clean(input.answer, MAX_ANSWER_CHARS, "Answer"),
    ...(intents.length > 0 ? { intents } : {}),
  };
}

export function parseDelimitedCommand(raw: string, platform: Platform): VerificationInput {
  const withoutCommand = raw
    .replace(/^\s*\/(?:glassbox|analyze)(?:@[\w_]+)?\s*/i, "")
    .replace(/^\s*(?:glassbox|analyze)\s*/i, "")
    .trim();
  const parts = withoutCommand.split("||").map((part) => part.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new InputError("Use: question || answer || optional intent 1; optional intent 2");
  }
  const intents = parts.slice(2).join("||").split(";").map((part) => part.trim()).filter(Boolean);
  return normalizeInput({ question: parts[0], answer: parts[1], intents, platform });
}

export function parseIntentList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.split(";").map((intent) => intent.trim()).filter(Boolean).slice(0, MAX_INTENTS);
}
