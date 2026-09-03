import type { ConstitutionRule, Platform, ResponseAction, VerificationInput } from "./types.js";

export const MAX_QUESTION_CHARS = 6_000;
export const MAX_ANSWER_CHARS = 12_000;
export const MAX_INTENTS = 8;
export const MAX_INTENT_CHARS = 1_000;
export const MAX_TOTAL_INTENT_CHARS = 4_000;
export const MAX_CONSTITUTION_RULES = 32;

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

  const checkpoint = normalizeCheckpoint(input.checkpoint);
  const constitution = normalizeConstitution(input.constitution);
  const responsePolicy = normalizeResponsePolicy(input.response_policy);
  return {
    platform: input.platform,
    question: clean(input.question, MAX_QUESTION_CHARS, "Question"),
    answer: clean(input.answer, MAX_ANSWER_CHARS, "Answer"),
    ...(intents.length > 0 ? { intents } : {}),
    ...(checkpoint ? { checkpoint } : {}),
    ...(constitution ? { constitution } : {}),
    ...(responsePolicy ? { response_policy: responsePolicy } : {}),
  };
}

function normalizeCheckpoint(value: VerificationInput["checkpoint"]): VerificationInput["checkpoint"] {
  if (!value) return undefined;
  if (!["input", "model_output", "agent_step", "tool_call", "final_output"].includes(value.type)) throw new InputError("Checkpoint type is not supported.");
  return { id: clean(String(value.id), 120, "Checkpoint id"), type: value.type, ...(value.actor ? { actor: clean(String(value.actor), 200, "Checkpoint actor") } : {}), ...(value.target ? { target: clean(String(value.target), 500, "Checkpoint target") } : {}) };
}

function normalizeConstitution(value: VerificationInput["constitution"]): VerificationInput["constitution"] {
  if (!value) return undefined;
  if (!Array.isArray(value.rules) || value.rules.length === 0) throw new InputError("A constitution must contain at least one rule.");
  if (value.rules.length > MAX_CONSTITUTION_RULES) throw new InputError(`A constitution may contain at most ${MAX_CONSTITUTION_RULES} rules.`);
  const ids = new Set<string>();
  const kinds = new Set(["require_phrase", "forbid_phrase", "require_citation", "forbid_absolute_certainty"]);
  const severities = new Set(["low", "medium", "high", "critical"]);
  const rules: ConstitutionRule[] = value.rules.map((rule) => {
    const id = clean(String(rule.id), 80, "Rule id");
    if (ids.has(id)) throw new InputError(`Duplicate constitution rule id: ${id}.`);
    ids.add(id);
    if (!kinds.has(rule.kind)) throw new InputError(`Unsupported constitution rule kind: ${String(rule.kind)}.`);
    if (!severities.has(rule.severity)) throw new InputError(`Unsupported rule severity: ${String(rule.severity)}.`);
    const ruleValue = rule.value?.trim();
    if ((rule.kind === "require_phrase" || rule.kind === "forbid_phrase") && !ruleValue) throw new InputError(`Rule ${id} requires a value.`);
    if (ruleValue && ruleValue.length > 500) throw new InputError(`Rule ${id} value is too long.`);
    return { id, requirement: clean(String(rule.requirement), 500, "Rule requirement"), kind: rule.kind, severity: rule.severity, ...(ruleValue ? { value: ruleValue } : {}) };
  });
  return { version: clean(String(value.version), 120, "Constitution version"), rules };
}

function normalizeResponsePolicy(value: VerificationInput["response_policy"]): VerificationInput["response_policy"] {
  if (!value) return undefined;
  const actions = new Set<ResponseAction>(["allow", "record", "block", "retry", "escalate"]);
  for (const action of [value.trust, value.caution, value.reject]) if (action && !actions.has(action)) throw new InputError(`Unsupported response action: ${String(action)}.`);
  return { ...(value.trust ? { trust: value.trust } : {}), ...(value.caution ? { caution: value.caution } : {}), ...(value.reject ? { reject: value.reject } : {}) };
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
