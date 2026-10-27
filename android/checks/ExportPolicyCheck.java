package tw.tony.luckynote;

import java.util.Base64;

/** Runs the critical pure-Java policy checks without an Android SDK or downloaded dependencies. */
public final class ExportPolicyCheck {
    private static int checks;
    private static void check(boolean value) { if (!value) throw new AssertionError("check " + (checks + 1)); checks++; }
    private static void rejected(Runnable action) {
        try { action.run(); throw new AssertionError("expected rejection"); }
        catch (IllegalArgumentException expected) { checks++; }
    }
    public static void main(String[] args) {
        check(ExportPolicy.trusted(ExportPolicy.ORIGIN, true));
        check(!ExportPolicy.trusted(ExportPolicy.ORIGIN, false));
        check(!ExportPolicy.trusted("https://appassets.androidplatform.net.attacker.example", true));
        check(!ExportPolicy.trusted("http://appassets.androidplatform.net", true));
        check(!ExportPolicy.trusted("null", true));
        check(ExportPolicy.decode("application/json", "AQID").length == 3);
        check(ExportPolicy.decode("text/plain", "").length == 0);
        check(ExportPolicy.decode("text/markdown", Base64.getEncoder().encodeToString(new byte[ExportPolicy.MAX_BYTES])).length == ExportPolicy.MAX_BYTES);
        rejected(() -> ExportPolicy.decode("text/html", "AQID"));
        rejected(() -> ExportPolicy.decode("text/plain", "%%%"));
        rejected(() -> ExportPolicy.decode("text/plain", Base64.getEncoder().encodeToString(new byte[ExportPolicy.MAX_BYTES + 1])));
        String safe = ExportPolicy.safeName("../../Downloads/file.html", "application/json");
        check(!safe.contains("/") && !safe.contains("\\") && !safe.startsWith(".") && safe.endsWith(".json"));
        check("LuckyNote-export.md".equals(ExportPolicy.safeName("", "text/markdown")));
        ExportPolicy state = new ExportPolicy();
        state.begin("first");
        rejected(() -> state.begin("first"));
        rejected(() -> state.begin("second"));
        state.finish("first");
        rejected(() -> state.begin("first"));
        state.begin("second");
        state.finish("second");
        state.begin("cancelled");
        state.finish("cancelled");
        rejected(() -> state.begin("cancelled"));
        state.begin("retry_new_id");
        rejected(() -> state.begin("invalid/path"));
        System.out.println("PASS: " + checks + " export policy checks (origin, main frame, MIME, size, filename, duplicate, cancel). Native Android UI was not executed.");
    }
}
