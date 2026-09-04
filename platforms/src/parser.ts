import { PLATFORMS, type ConstitutionRule, type ToolDeclaration, type Platform, type ResponseAction, type VerificationInput } from "./types.js";

export const MAX_QUESTION_CHARS = 6_000;
export const MAX_ANSWER_CHARS = 12_000;
export const MAX_INTENTS = 8;
export const MAX_INTENT_CHARS = 1_000;
export const MAX_TOTAL_INTENT_CHARS = 4_000;
export const MAX_CONSTITUTION_RULES = 32;
export const MAX_TOOL_NAME_CHARS = 200;
export const MAX_TOOL_ARGUMENT_CHARS = 8_000;
export const MAX_TOOL_DESCRIPTION_CHARS = 4_000;
export const MAX_TOOL_PINS = 64;
export const MAX_ALLOWED_TOOLS = 128;

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
  if (!PLATFORMS.includes(input.platform)) throw new InputError("Platform is not supported.");
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
  const tool = normalizeTool(input.tool);
  const toolPins = normalizeToolPins(input.tool_pins);
  const allowedTools = normalizeAllowedTools(input.allowed_tools);
  return {
    platform: input.platform,
    question: clean(input.question, MAX_QUESTION_CHARS, "Question"),
    answer: clean(input.answer, MAX_ANSWER_CHARS, "Answer"),
    ...(intents.length > 0 ? { intents } : {}),
    ...(checkpoint ? { checkpoint } : {}),
    ...(constitution ? { constitution } : {}),
    ...(responsePolicy ? { response_policy: responsePolicy } : {}),
    ...(tool ? { tool } : {}),
    ...(toolPins ? { tool_pins: toolPins } : {}),
    ...(allowedTools ? { allowed_tools: allowedTools } : {}),
  };
}

/**
 * Tool fields are allowlisted and bounded like every other input. They are validated here
 * rather than in the verifier because an unvalidated field that reaches the verifier and
 * is silently dropped is the failure mode that already cost this codebase once: the
 * checkpoint, constitution and response-policy fields were accepted by the API and
 * discarded before verification, so callers believed governance was applied when it was not.
 */
function normalizeTool(value: VerificationInput["tool"]): VerificationInput["tool"] {
  if (!value) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new InputError("Tool must be an object.");
  if (typeof value.tool !== "string") throw new InputError("Tool name must be a string.");
  const name = clean(value.tool, MAX_TOOL_NAME_CHARS, "Tool name");

  let args: Record<string, unknown> | undefined;
  if (value.arguments !== undefined) {
    if (typeof value.arguments !== "object" || value.arguments === null || Array.isArray(value.arguments)) {
      throw new InputError("Tool arguments must be a JSON object.");
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(value.arguments);
    } catch {
      throw new InputError("Tool arguments must be JSON-serializable.");
    }
    if (serialized.length > MAX_TOOL_ARGUMENT_CHARS) {
      throw new InputError(`Tool arguments are too long (${serialized.length}/${MAX_TOOL_ARGUMENT_CHARS} characters).`);
    }
    args = value.arguments;
  }

  let declaration: ToolDeclaration | undefined;
  if (value.declaration !== undefined) {
    const raw = value.declaration;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new InputError("Tool declaration must be an object.");
    }
    if (typeof raw.name !== "string") throw new InputError("Tool declaration name must be a string.");
    declaration = {
      name: clean(raw.name, MAX_TOOL_NAME_CHARS, "Tool declaration name"),
      ...(raw.description !== undefined
        ? { description: clean(String(raw.description), MAX_TOOL_DESCRIPTION_CHARS, "Tool description") }
        : {}),
      ...(raw.input_schema !== undefined ? { input_schema: raw.input_schema } : {}),
    };
  }

  return { tool: name, ...(args ? { arguments: args } : {}), ...(declaration ? { declaration } : {}) };
}

function normalizeToolPins(value: VerificationInput["tool_pins"]): VerificationInput["tool_pins"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new InputError("Tool pins must be an array.");
  if (value.length > MAX_TOOL_PINS) throw new InputError(`At most ${MAX_TOOL_PINS} tool pins may be supplied.`);
  return value.map((pin) => {
    if (!pin || typeof pin !== "object" || Array.isArray(pin)) throw new InputError("Every tool pin must be an object.");
    if (typeof pin.tool !== "string" || typeof pin.declaration_hash !== "string") {
      throw new InputError("A tool pin needs a tool name and a declaration hash.");
    }
    if (!/^[a-f0-9]{64}$/.test(pin.declaration_hash)) {
      throw new InputError("A tool pin declaration hash must be a SHA-256 hex digest.");
    }
    const components = pin.component_hashes;
    if (components !== undefined) {
      const valid = components && typeof components === "object" && !Array.isArray(components) &&
        (["name", "description", "schema"] as const).every((key) => /^[a-f0-9]{64}$/.test(String(components[key])));
      if (!valid) throw new InputError("Tool pin component hashes must be SHA-256 hex digests.");
    }
    return {
      tool: clean(pin.tool, MAX_TOOL_NAME_CHARS, "Tool pin name"),
      declaration_hash: pin.declaration_hash,
      ...(components ? { component_hashes: components } : {}),
      // Carried through rather than dropped: a pin whose version is silently discarded
      // becomes indistinguishable from a pre-versioning pin, which is the one case the
      // drift check has to handle differently.
      ...(pin.pin_version !== undefined
        ? { pin_version: clean(String(pin.pin_version), 32, "Tool pin version") }
        : {}),
      ...(pin.pinned_at ? { pinned_at: clean(String(pin.pinned_at), 64, "Tool pin timestamp") } : {}),
    };
  });
}

function normalizeAllowedTools(value: VerificationInput["allowed_tools"]): VerificationInput["allowed_tools"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new InputError("Allowed tools must be an array.");
  if (value.length > MAX_ALLOWED_TOOLS) throw new InputError(`At most ${MAX_ALLOWED_TOOLS} allowed tools may be supplied.`);
  // An empty array is meaningful: it declares that no tool is permitted.
  return value.map((name) => {
    if (typeof name !== "string") throw new InputError("Every allowed tool must be a string.");
    return clean(name, MAX_TOOL_NAME_CHARS, "Allowed tool name");
  });
}

function normalizeCheckpoint(value: VerificationInput["checkpoint"]): VerificationInput["checkpoint"] {
  if (!value) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new InputError("Checkpoint must be an object.");
  if (!["input", "model_output", "agent_step", "tool_call", "final_output"].includes(value.type)) throw new InputError("Checkpoint type is not supported.");
  return { id: clean(String(value.id), 120, "Checkpoint id"), type: value.type, ...(value.actor ? { actor: clean(String(value.actor), 200, "Checkpoint actor") } : {}), ...(value.target ? { target: clean(String(value.target), 500, "Checkpoint target") } : {}) };
}

function normalizeConstitution(value: VerificationInput["constitution"]): VerificationInput["constitution"] {
  if (!value) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new InputError("Constitution must be an object.");
  if (!Array.isArray(value.rules) || value.rules.length === 0) throw new InputError("A constitution must contain at least one rule.");
  if (value.rules.length > MAX_CONSTITUTION_RULES) throw new InputError(`A constitution may contain at most ${MAX_CONSTITUTION_RULES} rules.`);
  const ids = new Set<string>();
  const kinds = new Set(["require_phrase", "forbid_phrase", "require_citation", "forbid_absolute_certainty", "allow_target", "forbid_target"]);
  const severities = new Set(["low", "medium", "high", "critical"]);
  const rules: ConstitutionRule[] = value.rules.map((rule) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new InputError("Every constitution rule must be an object.");
    const id = clean(String(rule.id), 80, "Rule id");
    if (ids.has(id)) throw new InputError(`Duplicate constitution rule id: ${id}.`);
    ids.add(id);
    if (!kinds.has(rule.kind)) throw new InputError(`Unsupported constitution rule kind: ${String(rule.kind)}.`);
    if (!severities.has(rule.severity)) throw new InputError(`Unsupported rule severity: ${String(rule.severity)}.`);
    const ruleValue = typeof rule.value === "string" ? rule.value.trim() : undefined;
    if (["require_phrase", "forbid_phrase", "allow_target", "forbid_target"].includes(rule.kind) && !ruleValue) throw new InputError(`Rule ${id} requires a value.`);
    if (ruleValue && ruleValue.length > 500) throw new InputError(`Rule ${id} value is too long.`);
    return { id, requirement: clean(String(rule.requirement), 500, "Rule requirement"), kind: rule.kind, severity: rule.severity, ...(ruleValue ? { value: ruleValue } : {}) };
  });
  return { version: clean(String(value.version), 120, "Constitution version"), rules };
}

function normalizeResponsePolicy(value: VerificationInput["response_policy"]): VerificationInput["response_policy"] {
  if (!value) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new InputError("Response policy must be an object.");
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
