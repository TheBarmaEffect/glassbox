"use strict";

const api = globalThis.browser ?? globalThis.chrome;
const form = document.querySelector("#audit-form");
const question = document.querySelector("#question");
const answer = document.querySelector("#answer");
const intents = document.querySelector("#intents");
const submit = document.querySelector("#submit");
const clear = document.querySelector("#clear");
const notice = document.querySelector("#notice");
const result = document.querySelector("#result");
const questionCount = document.querySelector("#question-count");
const answerCount = document.querySelector("#answer-count");

question.addEventListener("input", updateCounts);
answer.addEventListener("input", updateCounts);
clear.addEventListener("click", reset);
form.addEventListener("submit", runAudit);
void consumeSelection();
updateCounts();

async function consumeSelection() {
  try {
    const response = await sendMessage({ type: "glassbox:consume-selection" });
    if (!response?.ok || typeof response.value !== "string") return;
    answer.value = response.value;
    if (!question.value) question.value = "Audit the explicitly selected text for reasoning and evidentiary risks.";
    setNotice("Selected text is ready. Review it, then press Run audit to send it.");
    updateCounts();
  } catch {
    setNotice("The selected text expired. Paste it again to continue.", true);
  }
}

async function runAudit(event) {
  event.preventDefault();
  result.hidden = true;
  result.replaceChildren();
  setBusy(true);
  setNotice("Sending only these explicit fields to GlassBox Lite…");
  try {
    const requirements = intents.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const response = await sendMessage({
      type: "glassbox:audit",
      input: { question: question.value, answer: answer.value, intents: requirements },
    });
    if (!response?.ok) throw new Error(response?.error?.message ?? "GlassBox could not complete this audit.");
    renderResult(response.value);
    setNotice("Audit complete. The submitted text was not persisted by the extension.");
  } catch (error) {
    setNotice(typeof error?.message === "string" ? error.message : "GlassBox could not complete this audit.", true);
  } finally {
    setBusy(false);
  }
}

function renderResult(value) {
  const head = element("div", "result-head");
  head.append(element("span", `verdict ${value.verdict}`, value.verdict));
  head.append(element("span", "score", `${(value.score * 100).toFixed(1)}%`));
  result.append(head, element("p", "summary", value.summary));

  const metrics = element("div", "metrics");
  metrics.append(metric(value.claim_count, "Claims"));
  metrics.append(metric(value.finding_count, "Findings"));
  metrics.append(metric(value.highest_severity, "Highest severity"));
  result.append(metrics);

  if (value.findings.length) {
    result.append(element("h2", "", "Findings"), records(value.findings, false));
  }
  result.append(element("h2", "", "Checks"), records(value.probes, true));
  result.append(element("h2", "", "Scope caveats"), simpleList(value.caveats));
  result.hidden = false;
}

function records(values, includePass) {
  const list = document.createElement("ul");
  for (const value of values) {
    const item = document.createElement("li");
    const prefix = includePass ? `${value.passed ? "Pass" : "Flag"} · ` : "";
    const strong = element("strong", "", `${prefix}${humanize(value.angle)} · ${value.severity}`);
    item.append(strong, document.createTextNode(` — ${value.summary}`));
    list.append(item);
  }
  return list;
}

function simpleList(values) {
  const list = document.createElement("ul");
  for (const value of values) list.append(element("li", "", value));
  return list;
}

function metric(value, label) {
  const wrapper = element("div", "metric");
  wrapper.append(element("strong", "", String(value)), element("span", "", label));
  return wrapper;
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function humanize(value) {
  return value.replaceAll("_", " ");
}

function reset() {
  form.reset();
  result.hidden = true;
  result.replaceChildren();
  setNotice("");
  updateCounts();
  question.focus();
}

function updateCounts() {
  questionCount.textContent = `${question.value.length.toLocaleString("en-US")} / 6,000`;
  answerCount.textContent = `${answer.value.length.toLocaleString("en-US")} / 12,000`;
}

function setBusy(busy) {
  submit.disabled = busy;
  clear.disabled = busy;
  submit.textContent = busy ? "Auditing…" : "Run audit";
}

function setNotice(message, error = false) {
  notice.textContent = message;
  notice.classList.toggle("error", error);
}

function sendMessage(payload) {
  if (globalThis.browser) return globalThis.browser.runtime.sendMessage(payload);
  return new Promise((resolve, reject) => {
    globalThis.chrome.runtime.sendMessage(payload, (response) => {
      const runtimeError = globalThis.chrome.runtime.lastError;
      if (runtimeError) reject(new Error(runtimeError.message));
      else resolve(response);
    });
  });
}
