import * as vscode from "vscode";
import {
  DEFAULT_ENDPOINT,
  formatResult,
  MAX_ANSWER_CHARS,
  MAX_QUESTION_CHARS,
  verifyAnswer,
} from "./mcp-client";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("GlassBox Lite");
  context.subscriptions.push(output);
  context.subscriptions.push(vscode.commands.registerCommand("glassbox.auditSelection", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage("Select the answer text you want GlassBox to audit first.");
      return;
    }
    const answer = editor.document.getText(editor.selection).trim();
    if (!answer) return;
    if (answer.length > MAX_ANSWER_CHARS) {
      void vscode.window.showErrorMessage(`The selection exceeds GlassBox's ${MAX_ANSWER_CHARS}-character limit.`);
      return;
    }
    const question = await vscode.window.showInputBox({
      title: "GlassBox Lite",
      prompt: "What original question or task was this selected answer responding to?",
      placeHolder: "Enter the original question",
      ignoreFocusOut: true,
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return "The original question is required.";
        if (trimmed.length > MAX_QUESTION_CHARS) return `Use at most ${MAX_QUESTION_CHARS} characters.`;
        return undefined;
      },
    });
    if (!question) return;
    const consent = await vscode.window.showWarningMessage(
      `Send this ${answer.length}-character selection and your question over HTTPS to GlassBox Lite for this audit? ` +
      "The service processes them transiently on Render, uses no paid model or web lookup, and does not persist raw content.",
      { modal: true },
      "Audit once",
    );
    if (consent !== "Audit once") return;

    const endpoint = vscode.workspace.getConfiguration("glassbox").get<string>("endpoint", DEFAULT_ENDPOINT);
    const controller = new AbortController();
    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "GlassBox is auditing the selected text…",
          cancellable: true,
        },
        async (_progress, token) => {
          token.onCancellationRequested(() => controller.abort());
          return verifyAnswer({ endpoint, question, answer, signal: controller.signal });
        },
      );
      output.clear();
      output.appendLine(formatResult(result));
      output.show(true);
      void vscode.window.showInformationMessage(`GlassBox: ${result.verdict.toUpperCase()} · ${(result.score * 100).toFixed(1)}%`);
    } catch (error) {
      const message = controller.signal.aborted
        ? "GlassBox audit cancelled."
        : error instanceof Error ? error.message : "GlassBox audit failed.";
      void vscode.window.showErrorMessage(message);
    }
  }));
}

export function deactivate(): void {}
