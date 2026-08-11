package dev.glassbox.lite;

import java.util.Locale;

public final class GlassboxResultFormatter {
    private GlassboxResultFormatter() {}

    public static String format(PublicMcpResult result) {
        StringBuilder output = new StringBuilder()
                .append("Verdict: ").append(result.verdict().toUpperCase(Locale.ROOT)).append('\n')
                .append("Score: ").append(String.format(Locale.ROOT, "%.1f%%", result.score() * 100)).append('\n')
                .append("Claims analyzed: ").append(result.claimCount()).append('\n')
                .append("Highest severity: ").append(result.highestSeverity()).append('\n')
                .append("Summary: ").append(GlassboxMcpClient.sanitize(result.summary())).append('\n');
        if (!result.findings().isEmpty()) {
            output.append("\nFindings:\n");
            for (PublicMcpResult.Finding finding : result.findings()) {
                output.append("- ").append(finding.angle()).append(" (").append(finding.severity()).append("): ")
                        .append(GlassboxMcpClient.sanitize(finding.summary())).append('\n');
            }
        }
        output.append("\nCaveats:\n");
        for (String caveat : result.caveats()) {
            output.append("- ").append(GlassboxMcpClient.sanitize(caveat)).append('\n');
        }
        output.append("\nThe selected text is intentionally not repeated in this result.");
        return output.toString();
    }
}
