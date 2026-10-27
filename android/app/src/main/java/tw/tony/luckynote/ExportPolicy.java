package tw.tony.luckynote;

import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.Set;

/** Pure policy shared by the native export handler and local JVM regression tests. */
final class ExportPolicy {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final int MAX_BYTES = 10 * 1024 * 1024;
    static final int MAX_ENCODED = ((MAX_BYTES + 2) / 3) * 4;
    private final Set<String> usedIds = new LinkedHashSet<>();
    private String pendingId;

    static boolean trusted(String origin, boolean mainFrame) { return mainFrame && ORIGIN.equals(origin); }
    static boolean validId(String id) { return id != null && id.matches("[A-Za-z0-9_-]{1,80}"); }

    static byte[] decode(String mime, String encoded) {
        if (!"application/json".equals(mime) && !"text/plain".equals(mime) && !"text/markdown".equals(mime)) throw new IllegalArgumentException("unsupported_mime");
        if (encoded == null || encoded.length() > MAX_ENCODED) throw new IllegalArgumentException("too_large");
        byte[] decoded;
        try { decoded = Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException error) { throw new IllegalArgumentException("invalid_base64"); }
        if (decoded.length > MAX_BYTES) throw new IllegalArgumentException("too_large");
        return decoded;
    }

    static String safeName(String name, String mime) {
        String safe = name == null ? "" : name.replaceAll("[^\\p{L}\\p{N}._ -]", "_").replaceAll("^\\.+", "").trim();
        if (safe.length() > 96) safe = safe.substring(0, 96);
        if (safe.isEmpty()) safe = "LuckyNote-export";
        String extension = "application/json".equals(mime) ? ".json" : ("text/markdown".equals(mime) ? ".md" : ".txt");
        if (!safe.toLowerCase(java.util.Locale.ROOT).endsWith(extension)) safe += extension;
        return safe;
    }

    synchronized void begin(String id) {
        if (!validId(id)) throw new IllegalArgumentException("invalid_id");
        if (usedIds.contains(id)) throw new IllegalArgumentException("duplicate_id");
        if (pendingId != null) throw new IllegalArgumentException("export_busy");
        if (usedIds.size() >= 1024) throw new IllegalArgumentException("session_limit");
        usedIds.add(id);
        pendingId = id;
    }

    synchronized void finish(String id) { if (id.equals(pendingId)) pendingId = null; }
}
