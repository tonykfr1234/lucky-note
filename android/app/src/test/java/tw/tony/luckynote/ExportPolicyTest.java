package tw.tony.luckynote;

import static org.junit.Assert.*;
import java.util.Base64;
import org.junit.Test;

public class ExportPolicyTest {
    @Test public void onlyExactMainFrameOriginIsTrusted() {
        assertTrue(ExportPolicy.trusted(ExportPolicy.ORIGIN, true));
        assertFalse(ExportPolicy.trusted(ExportPolicy.ORIGIN, false));
        assertFalse(ExportPolicy.trusted("https://example.org", true));
        assertFalse(ExportPolicy.trusted("https://appassets.androidplatform.net.attacker.example", true));
        assertFalse(ExportPolicy.trusted("http://appassets.androidplatform.net", true));
        assertFalse(ExportPolicy.trusted("null", true));
    }
    @Test public void supportedMimeAndExactLimitWork() {
        assertArrayEquals(new byte[]{1, 2, 3}, ExportPolicy.decode("application/json", "AQID"));
        assertArrayEquals(new byte[0], ExportPolicy.decode("text/plain", ""));
        byte[] maximum = new byte[ExportPolicy.MAX_BYTES];
        assertEquals(maximum.length, ExportPolicy.decode("text/markdown", Base64.getEncoder().encodeToString(maximum)).length);
    }
    @Test public void oversizedAndInvalidPayloadsAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> ExportPolicy.decode("text/html", "AQID"));
        assertThrows(IllegalArgumentException.class, () -> ExportPolicy.decode("application/octet-stream", "AQID"));
        assertThrows(IllegalArgumentException.class, () -> ExportPolicy.decode("text/plain", "%%%"));
        assertThrows(IllegalArgumentException.class, () -> ExportPolicy.decode("text/plain", Base64.getEncoder().encodeToString(new byte[ExportPolicy.MAX_BYTES + 1])));
    }
    @Test public void fileNameCannotChooseDestinationOrExecutableType() {
        String name = ExportPolicy.safeName("../../Downloads/惡意\\file.html", "application/json");
        assertFalse(name.contains("/"));
        assertFalse(name.contains("\\"));
        assertFalse(name.startsWith("."));
        assertTrue(name.endsWith(".json"));
        assertEquals("LuckyNote-export.md", ExportPolicy.safeName("", "text/markdown"));
        assertEquals("note.txt", ExportPolicy.safeName("note.txt", "text/plain"));
    }
    @Test public void pendingAndRepeatedRequestsAreRejected() {
        ExportPolicy state = new ExportPolicy();
        state.begin("first");
        assertThrows(IllegalArgumentException.class, () -> state.begin("first"));
        assertThrows(IllegalArgumentException.class, () -> state.begin("second"));
        state.finish("first");
        assertThrows(IllegalArgumentException.class, () -> state.begin("first"));
        state.begin("second");
        state.finish("second");
    }
    @Test public void cancellationReleasesSlotButDoesNotReplayRequest() {
        ExportPolicy state = new ExportPolicy();
        state.begin("cancelled");
        state.finish("cancelled");
        assertThrows(IllegalArgumentException.class, () -> state.begin("cancelled"));
        state.begin("new_attempt");
        assertThrows(IllegalArgumentException.class, () -> state.begin("path/invalid"));
    }
}
