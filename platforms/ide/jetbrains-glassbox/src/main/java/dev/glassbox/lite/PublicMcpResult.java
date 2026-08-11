package dev.glassbox.lite;

import java.util.List;

public record PublicMcpResult(
        String verdict,
        String summary,
        double score,
        int claimCount,
        int findingCount,
        String highestSeverity,
        List<Finding> findings,
        List<Probe> probes,
        List<String> caveats
) {
    public record Finding(String angle, String severity, String summary) {}
    public record Probe(String angle, boolean passed, String severity, String summary) {}
}
