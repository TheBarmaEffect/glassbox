package dev.glassbox.lite;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public final class GlassboxMcpClient {
    public static final URI ENDPOINT = URI.create("https://glassbox-platform-gateway.onrender.com/mcp");
    public static final int MAX_QUESTION_CHARS = 6_000;
    public static final int MAX_ANSWER_CHARS = 12_000;
    private static final int MAX_RESPONSE_BYTES = 128_000;
    private static final Set<String> VERDICTS = Set.of("trust", "caution", "reject");
    private static final Set<String> SEVERITIES = Set.of("low", "medium", "high", "critical");
    private static final Set<String> ANGLES = Set.of(
            "claim_extraction", "unsupported_certainty", "internal_contradiction", "prompt_injection",
            "fact_check_scope", "citation_verifiability", "arithmetic_sanity"
    );
    private static final Set<String> FORBIDDEN = Set.of(
            "question", "answer", "audit", "generated_at", "log_id", "inputs_hash"
    );

    private final HttpClient http;

    public GlassboxMcpClient() {
        this(HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build());
    }

    GlassboxMcpClient(HttpClient http) {
        this.http = http;
    }

    public PublicMcpResult verify(String rawQuestion, String rawAnswer) throws IOException, InterruptedException {
        String question = boundedInput(rawQuestion, MAX_QUESTION_CHARS, "Question");
        String answer = boundedInput(rawAnswer, MAX_ANSWER_CHARS, "Selection");
        JsonObject arguments = new JsonObject();
        arguments.addProperty("question", question);
        arguments.addProperty("answer", answer);
        JsonObject params = new JsonObject();
        params.addProperty("name", "glassbox_verify_answer");
        params.add("arguments", arguments);
        JsonObject payload = new JsonObject();
        payload.addProperty("jsonrpc", "2.0");
        payload.addProperty("id", UUID.randomUUID().toString());
        payload.addProperty("method", "tools/call");
        payload.add("params", params);

        HttpRequest request = HttpRequest.newBuilder(ENDPOINT)
                .timeout(Duration.ofSeconds(30))
                .header("Accept", "application/json, text/event-stream")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(payload.toString(), StandardCharsets.UTF_8))
                .build();
        HttpResponse<InputStream> response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
        byte[] bytes;
        try (InputStream stream = response.body()) {
            bytes = stream.readNBytes(MAX_RESPONSE_BYTES + 1);
        }
        if (bytes.length > MAX_RESPONSE_BYTES) throw new IOException("GlassBox returned an oversized response.");
        String contentType = response.headers().firstValue("content-type").orElse("");
        return parseResponse(response.statusCode(), contentType, new String(bytes, StandardCharsets.UTF_8));
    }

    static PublicMcpResult parseResponse(int status, String contentType, String body) throws IOException {
        if (status < 200 || status >= 300) throw new IOException("GlassBox request failed (" + status + ").");
        JsonObject envelope = contentType.toLowerCase().contains("text/event-stream")
                ? parseEventStream(body)
                : parseObject(body, "GlassBox response");
        if (envelope.has("error")) throw new IOException("GlassBox rejected the audit.");
        JsonObject rpcResult = object(envelope.get("result"), "MCP result");
        JsonObject result = object(rpcResult.get("structuredContent"), "GlassBox structured result");
        for (String forbidden : FORBIDDEN) {
            if (result.has(forbidden)) throw new IOException("GlassBox returned non-public audit data.");
        }
        String verdict = enumString(result, "verdict", VERDICTS);
        String summary = outputString(result, "summary");
        double score = decimal(result, "score", 0, 1);
        int claimCount = integer(result, "claim_count", 0, 24);
        int findingCount = integer(result, "finding_count", 0, 7);
        String highestSeverity = enumString(result, "highest_severity", SEVERITIES);
        List<PublicMcpResult.Finding> findings = findings(result.get("findings"));
        if (findingCount != findings.size()) throw new IOException("GlassBox finding count did not match its findings.");
        List<PublicMcpResult.Probe> probes = probes(result.get("probes"));
        List<String> caveats = strings(result.get("caveats"), "caveats", 8);
        return new PublicMcpResult(verdict, summary, score, claimCount, findingCount, highestSeverity, findings, probes, caveats);
    }

    private static JsonObject parseEventStream(String body) throws IOException {
        JsonObject found = null;
        for (String line : body.split("\\R")) {
            if (!line.startsWith("data:")) continue;
            String data = line.substring(5).trim();
            if (data.isEmpty() || data.equals("[DONE]")) continue;
            JsonObject candidate = parseObject(data, "MCP event");
            if (candidate.has("result") || candidate.has("error")) found = candidate;
        }
        if (found == null) throw new IOException("GlassBox returned no MCP result event.");
        return found;
    }

    private static List<PublicMcpResult.Finding> findings(JsonElement value) throws IOException {
        JsonArray array = array(value, "findings", 7);
        List<PublicMcpResult.Finding> output = new ArrayList<>();
        for (JsonElement element : array) {
            JsonObject item = object(element, "finding");
            output.add(new PublicMcpResult.Finding(
                    enumString(item, "angle", ANGLES),
                    enumString(item, "severity", SEVERITIES),
                    outputString(item, "summary")
            ));
        }
        return List.copyOf(output);
    }

    private static List<PublicMcpResult.Probe> probes(JsonElement value) throws IOException {
        JsonArray array = array(value, "probes", 7);
        List<PublicMcpResult.Probe> output = new ArrayList<>();
        for (JsonElement element : array) {
            JsonObject item = object(element, "probe");
            JsonElement passed = item.get("passed");
            if (passed == null || !passed.isJsonPrimitive() || !passed.getAsJsonPrimitive().isBoolean()) {
                throw new IOException("GlassBox probe passed value was invalid.");
            }
            output.add(new PublicMcpResult.Probe(
                    enumString(item, "angle", ANGLES), passed.getAsBoolean(),
                    enumString(item, "severity", SEVERITIES), outputString(item, "summary")
            ));
        }
        return List.copyOf(output);
    }

    private static List<String> strings(JsonElement value, String label, int maximum) throws IOException {
        JsonArray array = array(value, label, maximum);
        List<String> output = new ArrayList<>();
        for (JsonElement item : array) output.add(outputString(item, label));
        return List.copyOf(output);
    }

    private static String boundedInput(String value, int maximum, String label) {
        String text = value == null ? "" : value.trim();
        if (text.isEmpty()) throw new IllegalArgumentException(label + " cannot be empty.");
        if (text.length() > maximum) throw new IllegalArgumentException(label + " exceeds the " + maximum + "-character limit.");
        return text;
    }

    private static String enumString(JsonObject object, String key, Set<String> allowed) throws IOException {
        String value = outputString(object, key);
        if (!allowed.contains(value)) throw new IOException("GlassBox " + key + " was invalid.");
        return value;
    }

    private static String outputString(JsonObject object, String key) throws IOException {
        return outputString(object.get(key), key);
    }

    private static String outputString(JsonElement value, String label) throws IOException {
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
            throw new IOException("GlassBox " + label + " was invalid.");
        }
        String text = sanitize(value.getAsString());
        if (text.isEmpty() || text.length() > 1_000) throw new IOException("GlassBox " + label + " was invalid.");
        return text;
    }

    static String sanitize(String value) {
        return value.replaceAll("[\\p{Cc}\\u202A-\\u202E\\u2066-\\u2069]", " ").replaceAll("\\s+", " ").trim();
    }

    private static double decimal(JsonObject object, String key, double minimum, double maximum) throws IOException {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw new IOException("GlassBox " + key + " was invalid.");
        }
        double number = value.getAsDouble();
        if (!Double.isFinite(number) || number < minimum || number > maximum) {
            throw new IOException("GlassBox " + key + " was invalid.");
        }
        return number;
    }

    private static int integer(JsonObject object, String key, int minimum, int maximum) throws IOException {
        double number = decimal(object, key, minimum, maximum);
        if (number != Math.rint(number)) throw new IOException("GlassBox " + key + " was invalid.");
        return (int) number;
    }

    private static JsonArray array(JsonElement value, String label, int maximum) throws IOException {
        if (value == null || !value.isJsonArray() || value.getAsJsonArray().size() > maximum) {
            throw new IOException("GlassBox " + label + " was invalid.");
        }
        return value.getAsJsonArray();
    }

    private static JsonObject object(JsonElement value, String label) throws IOException {
        if (value == null || !value.isJsonObject()) throw new IOException(label + " was missing or invalid.");
        return value.getAsJsonObject();
    }

    private static JsonObject parseObject(String value, String label) throws IOException {
        try {
            return object(JsonParser.parseString(value), label);
        } catch (RuntimeException error) {
            throw new IOException(label + " was not valid JSON.", error);
        }
    }
}
