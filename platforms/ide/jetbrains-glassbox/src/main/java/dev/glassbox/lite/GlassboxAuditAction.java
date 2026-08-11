package dev.glassbox.lite;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.ProgressManager;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

public final class GlassboxAuditAction extends AnAction {
    @Override
    public void update(@NotNull AnActionEvent event) {
        Editor editor = event.getData(CommonDataKeys.EDITOR);
        boolean selected = editor != null && editor.getSelectionModel().hasSelection();
        event.getPresentation().setEnabledAndVisible(selected);
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        Editor editor = event.getData(CommonDataKeys.EDITOR);
        if (project == null || editor == null) return;
        String answer = editor.getSelectionModel().getSelectedText();
        answer = answer == null ? "" : answer.trim();
        if (answer.isEmpty()) {
            Messages.showInfoMessage(project, "Select the answer text you want GlassBox to audit first.", "GlassBox Lite");
            return;
        }
        if (answer.length() > GlassboxMcpClient.MAX_ANSWER_CHARS) {
            Messages.showErrorDialog(project, "The selection exceeds GlassBox's 12,000-character limit.", "GlassBox Lite");
            return;
        }
        String question = Messages.showInputDialog(
                project,
                "What original question or task was this selected answer responding to?",
                "GlassBox Lite",
                Messages.getQuestionIcon()
        );
        if (question == null) return;
        question = question.trim();
        if (question.isEmpty() || question.length() > GlassboxMcpClient.MAX_QUESTION_CHARS) {
            Messages.showErrorDialog(project, "Enter an original question of at most 6,000 characters.", "GlassBox Lite");
            return;
        }
        int consent = Messages.showYesNoDialog(
                project,
                "Send this " + answer.length() + "-character selection and your question over HTTPS to GlassBox Lite for this audit?\n\n" +
                        "The service processes them transiently on Render, uses no paid model or web lookup, and does not persist raw content.",
                "Confirm One GlassBox Audit",
                "Audit once",
                "Cancel",
                Messages.getWarningIcon()
        );
        if (consent != Messages.YES) return;

        String finalQuestion = question;
        String finalAnswer = answer;
        ProgressManager.getInstance().run(new Task.Backgroundable(project, "GlassBox is auditing the selected text…", true) {
            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                try {
                    PublicMcpResult result = new GlassboxMcpClient().verify(finalQuestion, finalAnswer);
                    if (indicator.isCanceled()) return;
                    ApplicationManager.getApplication().invokeLater(() -> Messages.showInfoMessage(
                            project,
                            GlassboxResultFormatter.format(result),
                            "GlassBox Lite Audit"
                    ));
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                } catch (Exception error) {
                    String message = GlassboxMcpClient.sanitize(error.getMessage() == null ? "GlassBox audit failed." : error.getMessage());
                    ApplicationManager.getApplication().invokeLater(() -> Messages.showErrorDialog(project, message, "GlassBox Lite"));
                }
            }
        });
    }
}
