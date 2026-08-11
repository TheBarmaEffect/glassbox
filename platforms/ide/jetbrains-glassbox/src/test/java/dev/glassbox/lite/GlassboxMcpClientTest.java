package dev.glassbox.lite;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

final class GlassboxMcpClientTest {
    private static final String RESULT = """
            {"verdict":"reject","summary":"A deterministic structural check found a rejection-level issue.",
             "score":0.814,"claim_count":1,"finding_count":1,"highest_severity":"high",
             "findings":[{"angle":"arithmetic_sanity","severity":"high","summary":"Arithmetic failed."}],
             "probes":[{"angle":"arithmetic_sanity","passed":false,"severity":"high","summary":"Arithmetic failed."}],
             "caveats":["Not a web fact-check."]}
            """;

    @Test
    void parsesJsonAndEventStreamResponses() throws Exception {
        String compactResult = RESULT.replace("\n", "").replace("\r", "");
        String envelope = "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"result\":{\"structuredContent\":" + compactResult + "}}";
        assertEquals("reject", GlassboxMcpClient.parseResponse(200, "application/json", envelope).verdict());
        assertEquals(0.814, GlassboxMcpClient.parseResponse(200, "text/event-stream", "data: " + envelope + "\n\n").score());
    }

    @Test
    void rejectsPrivateFieldsAndMalformedScores() {
        String privateResult = RESULT.trim().replaceFirst("\\{", "{\"question\":\"private\",");
        assertThrows(IOException.class, () -> GlassboxMcpClient.parseResponse(
                200, "application/json", "{\"result\":{\"structuredContent\":" + privateResult + "}}"
        ));
        String invalid = RESULT.replace("0.814", "9");
        assertThrows(IOException.class, () -> GlassboxMcpClient.parseResponse(
                200, "application/json", "{\"result\":{\"structuredContent\":" + invalid + "}}"
        ));
    }

    @Test
    void formatterDoesNotRepeatSelectionAndNeutralizesControls() {
        PublicMcpResult result = new PublicMcpResult(
                "caution", "Summary\u202E.exe", 0.5, 1, 0, "low", List.of(), List.of(), List.of("Not a fact-check."));
        String formatted = GlassboxResultFormatter.format(result);
        assertFalse(formatted.contains("private selected answer"));
        assertFalse(formatted.contains("\u202E"));
        assertTrue(formatted.contains("intentionally not repeated"));
    }
}
