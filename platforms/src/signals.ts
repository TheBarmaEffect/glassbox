/**
 * Shared detection primitives.
 *
 * Extracted from lite.ts so the tool-invocation probes can reuse the exact same
 * normalizers and pattern sets. Reuse is the point: a credential in a tool-call argument
 * is the same credential it would be in an answer, and having two implementations drift
 * apart is how a detector silently stops covering one surface.
 *
 * Pure, deterministic, offline. No clock, no network, no model.
 */
import { Buffer } from "node:buffer";

export const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["AWS secret access key", /\bAWS_SECRET_ACCESS_KEY\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/i],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["OpenAI API key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Stripe live secret", /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/],
  ["npm token", /\bnpm_[A-Za-z0-9]{20,}\b/],
  ["assigned credential", /\b(?:api[_ -]?key|client[_ -]?secret|access[_ -]?token|auth[_ -]?token|private[_ -]?token)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{24,}["']?/i],
  ["bearer credential", /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i],
  ["JSON Web Token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];

export const DANGEROUS_ACTION_PATTERNS: Array<[string, RegExp]> = [
  ["destructive filesystem command", /\brm\s+-[^\n]*r[^\n]*f[^\n]*(?:\/|~|\$HOME)\b/i],
  ["download-and-execute pipeline", /\b(?:curl|wget)\b[^\n|]{0,300}\|\s*(?:sh|bash|zsh|powershell)\b/i],
  ["encoded PowerShell execution", /\bpowershell(?:\.exe)?\b[^\n]{0,160}\b(?:-enc|-encodedcommand)\b/i],
  ["reverse shell", /\b(?:nc|ncat|netcat)\b[^\n]{0,120}\s-e\s*(?:\/bin\/)?(?:sh|bash)|\/dev\/tcp\//i],
  ["firewall or security-control disabling", /\b(?:disable|stop|bypass|turn off)\b[^.!?\n]{0,60}\b(?:firewall|antivirus|endpoint protection|security control|guardrail)\b/i],
  ["firewall command disabling", /\b(?:ufw\s+disable|iptables(?:-legacy)?\s+(?:-[A-Za-z]*F\b|--flush\b)|nft\s+flush\s+ruleset|systemctl\s+(?:stop|disable)\s+(?:firewalld|ufw)\b|service\s+(?:firewalld|ufw)\s+stop\b|netsh\s+advfirewall\s+set\s+allprofiles\s+state\s+off\b|Set-NetFirewallProfile\b[^\n]{0,100}-Enabled\s+(?:False|\$false)\b)/i],
  ["cloud metadata access", /\b(?:curl|wget|Invoke-WebRequest)\b[^\n]{0,240}\b(?:169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200)\b/i],
  ["credential-file exfiltration", /\b(?:curl|wget)\b[^\n]{0,240}(?:@(?:\/etc\/(?:passwd|shadow)|~\/\.ssh\/|\$HOME\/\.ssh\/)|--data-binary\s+@)/i],
  ["destructive SQL", /\b(?:DROP\s+(?:DATABASE|TABLE)|TRUNCATE\s+TABLE)\b/i],
  ["script injection", /<script\b|javascript\s*:/i],
  ["path traversal", /(?:\.\.\/|\.\.\\){2,}/],
];

/**
 * Instruction-override and persona-override forms, one alternation branch per form.
 *
 * There is no property of a string that can be computed to decide "this is an injection",
 * so this detector is unavoidably a pattern set. What can be made structural is *where* a
 * phrase has to sit: every branch below requires the phrase to occupy the grammatical role
 * of a command or an assignment, not merely to appear. That distinction is what separates
 * an attack from prose discussing one, and it is where precision comes from here.
 */
export const PROMPT_INJECTION_PATTERN = new RegExp(
  [
    // "ignore/disregard/forget ... previous ... instructions"
    "\\b(?:ignore|disregard|forget)\\b.{0,40}\\b(?:previous|prior|above|system|developer)\\b.{0,25}\\b(?:instruction|message|prompt)s?\\b",
    // exfiltration of the system context
    "\\b(?:reveal|print|repeat|expose|leak)\\b.{0,40}\\b(?:system prompt|developer message|secret|credential|api key|token)\\b",
    "\\b(?:jailbreak|do anything now)\\b",
    // A privileged mode must be *switched into* to count. Matching the bare noun phrase
    // flagged "Developer mode in Chrome lets you inspect elements." as an attack, which is
    // a description of a browser feature; requiring an activating verb or a copular
    // assignment keeps "enter developer mode" and "you are now in developer mode" while
    // leaving every mention of the term alone.
    "\\b(?:enable|activate|enter|switch to|turn on|you are (?:now )?in)\\s+(?:developer|god|unrestricted|debug)\\s+mode\\b",
    // Persona overrides: the answer is told what it now is, or told that its limits are
    // lifted and that it must therefore comply.
    "\\byou are now\\b.{0,40}\\b(?:DAN|unrestricted|unfiltered|uncensored|no longer bound|not bound by)\\b",
    "\\b(?:no|without)\\s+(?:restrictions|limitations|filters|guardrails|safety)\\b.{0,30}\\b(?:must|will|should)\\s+comply\\b",
    "\\bact as (?:if you are )?(?:an? )?(?:unrestricted|unfiltered|uncensored|jailbroken)\\b",
    "\\bpretend (?:that )?you (?:have no|are not bound by)\\b",
    // role markers injected as content, tagged or bare
    "</?(?:system|assistant|developer)>",
    "\\[(?:INST|SYSTEM|ASSISTANT)\\]",
    "(?:^|[\\s\"(])(?:SYSTEM|ASSISTANT|DEVELOPER)\\s*:",
    "\\b(?:ignore|disregard|override|forget)\\s+(?:all\\s+|everything\\s+)?(?:the\\s+|your\\s+)?(?:above|previous|prior|earlier|preceding)\\b",
    "\\bforget everything\\b",
    "\\bnew instructions?\\s*:",
    "\\b(?:ignore|disregard|override|bypass)\\b.{0,30}\\b(?:safety|guardrail|guideline|restriction|policy|rule)s?\\b",
  ].join("|"),
  "i",
);

export const INVISIBLE_CHARACTERS = /[\p{Cf}\u034F\uFE00-\uFE0F]|[\u{E0100}-\u{E01EF}]/gu;

export const CONFUSABLES: Record<string, string> = {
  "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y",
  "\u0445": "x", "\u0456": "i", "\u0458": "j", "\u04BB": "h", "\u0455": "s", "\u0451": "e",
  "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041A": "K", "\u041C": "M", "\u041D": "H",
  "\u041E": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0425": "X", "\u0406": "I",
  "\u03B1": "a", "\u03B2": "b", "\u03B5": "e", "\u03B9": "i", "\u03BA": "k", "\u03BF": "o",
  "\u03C1": "p", "\u03C3": "o", "\u03C5": "u", "\u03BD": "v", "\u03C7": "x", "\u03B3": "y",
  "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H", "\u0399": "I",
  "\u039A": "K", "\u039C": "M", "\u039D": "N", "\u039F": "O", "\u03A1": "P", "\u03A4": "T",
  "\u03A5": "Y", "\u03A7": "X", "\u0501": "d", "\u0261": "g", "\u01C0": "l", "\u2170": "i",
};

export const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s",
};

export function stripInvisible(value: string): string {
  return value.normalize("NFKC").replace(INVISIBLE_CHARACTERS, "");
}

export function foldConfusables(value: string): string {
  return value.replace(/[\u0250-\u04FF\u0500-\u052F\u2160-\u217F\u01C0]/g, (character) => CONFUSABLES[character] ?? character);
}

export function foldLeet(value: string): string {
  return value.replace(/[013457@$]/g, (character) => LEET[character] ?? character);
}

export function base64Decodings(value: string): string[] {
  const decoded: string[] = [];
  // The leading boundary excludes only base64 *data* characters. Padding "=" never
  // precedes a payload, so including it here made "payload=<base64>" block itself.
  for (const match of value.matchAll(/(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{16,512}={0,2})(?![A-Za-z0-9+/=])/g)) {
    try {
      const candidate = Buffer.from(match[1] ?? "", "base64").toString("utf8");
      const printable = [...candidate].filter((character) => character === "\n" || character === "\r" || character === "\t" || character >= " ").length;
      if (candidate.length > 0 && printable / candidate.length > 0.9) decoded.push(candidate);
    } catch {
      // Invalid base64 remains ordinary submitted text.
    }
  }
  return decoded;
}

export function securityText(value: string): string {
  const cleaned = stripInvisible(value);
  const folded = foldLeet(foldConfusables(cleaned));
  return [folded, cleaned, ...base64Decodings(cleaned)].join("\n");
}

export function credentialText(value: string): string {
  const cleaned = stripInvisible(value);
  return [value, cleaned, ...base64Decodings(cleaned)].join("\n");
}

export function secretSignals(value: string): string[] {
  return SECRET_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
}

export function dangerousActionSignals(value: string): string[] {
  // Keep the original digits for IP addresses and command arguments, while also
  // testing the de-obfuscated representation used for leetspeak and hidden text.
  const candidates = [value.normalize("NFKC"), securityText(value)];
  return DANGEROUS_ACTION_PATTERNS
    .filter(([, pattern]) => candidates.some((candidate) => pattern.test(candidate)))
    .map(([name]) => name);
}
