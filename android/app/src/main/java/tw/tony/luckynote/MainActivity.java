package tw.tony.luckynote;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.view.WindowInsets;
import android.window.OnBackInvokedDispatcher;
import androidx.core.content.FileProvider;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final int PICK_FILE = 4101;
    private static final int SAVE_EXPORT = 4102;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri captureUri;
    private File captureFile;
    private final ExportPolicy exportPolicy = new ExportPolicy();
    private PendingExport pendingExport;

    private static final class PendingExport {
        final String id;
        final byte[] bytes;
        final JavaScriptReplyProxy reply;
        PendingExport(String id, byte[] bytes, JavaScriptReplyProxy reply) {
            this.id = id; this.bytes = bytes; this.reply = reply;
        }
    }

    @Override @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        FrameLayout frame = new FrameLayout(this);
        web = new WebView(this);
        frame.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(frame);
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
            }
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        frame.requestApplyInsets();
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isLocal(uri)) {
                    WebResourceResponse response = assets.shouldInterceptRequest(uri);
                    if (response != null) return response;
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", Collections.emptyMap(),
                        new ByteArrayInputStream("Local resource unavailable".getBytes(StandardCharsets.UTF_8)));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isLocal(request.getUrl())) return false;
                if (request.isForMainFrame() && request.hasGesture()) openExternal(request.getUrl());
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) toast(R.string.load_failed);
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) toast(R.string.load_failed);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent files = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                String[] accepts = params.getAcceptTypes();
                if (accepts != null && accepts.length > 0 && !accepts[0].isEmpty()) files.putExtra(Intent.EXTRA_MIME_TYPES, accepts);
                files.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                Intent chooser = Intent.createChooser(files, getString(R.string.choose_file));
                boolean imageAccepted = accepts == null || accepts.length == 0;
                if (accepts != null) for (String type : accepts) imageAccepted |= type.startsWith("image/") || type.isEmpty() || type.equals("*/*");
                captureUri = null;
                captureFile = null;
                if (imageAccepted) {
                    Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    if (camera.resolveActivity(getPackageManager()) != null) {
                        try {
                            File directory = new File(getCacheDir(), "captures");
                            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("capture_directory");
                            captureFile = File.createTempFile("selected-", ".jpg", directory);
                            captureUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".captures", captureFile);
                            camera.putExtra(MediaStore.EXTRA_OUTPUT, captureUri);
                            camera.setClipData(ClipData.newRawUri("selected capture", captureUri));
                            camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
                        } catch (IOException error) { captureUri = null; captureFile = null; }
                    }
                }
                try { startActivityForResult(chooser, PICK_FILE); }
                catch (RuntimeException error) { completeFileSelection(null); toast(R.string.open_failed); }
                return true;
            }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, android.os.Message result) {
                String destination = view.getHitTestResult().getExtra();
                if (userGesture && destination != null) openExternal(Uri.parse(destination));
                return false;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            if (url.startsWith("https://") && !isLocal(Uri.parse(url))) openExternal(Uri.parse(url));
            else toast(R.string.download_unavailable);
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "LuckyNoteExport", Collections.singleton(ExportPolicy.ORIGIN),
                    (view, message, origin, mainFrame, reply) -> {
                        if (!ExportPolicy.trusted(origin.toString(), mainFrame)) return;
                        if (message.getType() != WebMessageCompat.TYPE_STRING) { reply(reply, "", "error", "invalid_request"); return; }
                        handleExport(message.getData(), reply);
                    });
        }
        cleanOldCaptures();
        web.loadUrl(ExportPolicy.ORIGIN + "/index.html");
    }

    private boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private void openExternal(Uri uri) {
        if (!"https".equals(uri.getScheme()) || isLocal(uri)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException error) { toast(R.string.open_failed); }
    }

    private void handleExport(String raw, JavaScriptReplyProxy reply) {
        String id = "";
        try {
            if (raw == null || raw.length() > ExportPolicy.MAX_ENCODED + 4096) throw new IllegalArgumentException("too_large");
            JSONObject request = new JSONObject(raw);
            for (String field : new String[]{"id", "name", "mime", "base64"}) {
                if (!(request.get(field) instanceof String)) throw new IllegalArgumentException("invalid_request");
            }
            id = request.getString("id");
            if (!ExportPolicy.validId(id)) throw new IllegalArgumentException("invalid_id");
            if (request.length() != 4) throw new IllegalArgumentException("invalid_request");
            String mime = request.getString("mime");
            byte[] bytes = ExportPolicy.decode(mime, request.getString("base64"));
            String name = ExportPolicy.safeName(request.getString("name"), mime);
            exportPolicy.begin(id);
            pendingExport = new PendingExport(id, bytes, reply);
            Intent choose = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime).putExtra(Intent.EXTRA_TITLE, name);
            try { startActivityForResult(choose, SAVE_EXPORT); }
            catch (RuntimeException error) { finishExport("error", "document_provider_unavailable"); }
        } catch (Exception error) {
            String code = error instanceof IllegalArgumentException ? error.getMessage() : "invalid_request";
            reply(reply, ExportPolicy.validId(id) ? id : "", "error", code);
        }
    }

    private void reply(JavaScriptReplyProxy proxy, String id, String status, String error) {
        try {
            JSONObject response = new JSONObject().put("id", id).put("status", status);
            if (error != null) response.put("error", error);
            proxy.postMessage(response.toString());
        } catch (Exception ignored) { /* A document may navigate away; never log its contents. */ }
    }

    private void finishExport(String status, String error) {
        PendingExport pending = pendingExport;
        if (pending == null) return;
        pendingExport = null;
        exportPolicy.finish(pending.id);
        reply(pending.reply, pending.id, status, error);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            if (resultCode == RESULT_OK && result == null && captureUri != null && captureFile != null && captureFile.length() > 0) result = new Uri[]{captureUri};
            if (resultCode == RESULT_OK && data != null && data.getClipData() != null) {
                ClipData clip = data.getClipData();
                result = new Uri[clip.getItemCount()];
                for (int index = 0; index < result.length; index++) result[index] = clip.getItemAt(index).getUri();
            }
            completeFileSelection(safeSelection(result));
        } else if (requestCode == SAVE_EXPORT && pendingExport != null) {
            if (resultCode != RESULT_OK || data == null || data.getData() == null) { finishExport("cancel", null); return; }
            Uri destination = data.getData();
            if (!"content".equals(destination.getScheme())) { finishExport("error", "invalid_destination"); return; }
            final PendingExport pending = pendingExport;
            new Thread(() -> {
                String failure = null;
                try (OutputStream stream = getContentResolver().openOutputStream(destination, "wt")) {
                    if (stream == null) throw new IOException("missing_stream");
                    stream.write(pending.bytes);
                    stream.flush();
                } catch (Exception error) { failure = "write_failed"; }
                final String outcome = failure;
                runOnUiThread(() -> finishExport(outcome == null ? "saved" : "error", outcome));
            }, "LuckyNote-user-export").start();
        }
    }

    private void completeFileSelection(Uri[] result) {
        if (fileCallback != null) { fileCallback.onReceiveValue(result); fileCallback = null; }
        if (captureFile != null && captureFile.length() == 0) captureFile.delete();
        captureUri = null; captureFile = null;
    }

    private Uri[] safeSelection(Uri[] choices) {
        if (choices == null) return null;
        if (choices.length > 100) return null;
        for (Uri choice : choices) {
            if (choice == null || !"content".equals(choice.getScheme())) return null;
            String authority = choice.getAuthority();
            if (authority == null || authority.contains("@")) return null;
            if ((getPackageName() + ".captures").equals(authority) && !choice.equals(captureUri)) return null;
        }
        return choices;
    }

    private void cleanOldCaptures() {
        File[] captures = new File(getCacheDir(), "captures").listFiles();
        if (captures == null) return;
        long cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L;
        for (File capture : captures) if (capture.isFile() && capture.lastModified() < cutoff) capture.delete();
    }

    @Override public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        if (web.canGoBack()) { web.goBack(); return; }
        new AlertDialog.Builder(this).setTitle(R.string.exit_title).setMessage(R.string.exit_message)
                .setNegativeButton(R.string.stay, null).setPositiveButton(R.string.leave, (dialog, which) -> finish()).show();
    }

    private void toast(int resource) { Toast.makeText(this, resource, Toast.LENGTH_LONG).show(); }
    @Override protected void onDestroy() {
        completeFileSelection(null);
        if (web != null) { web.stopLoading(); web.destroy(); }
        pendingExport = null;
        super.onDestroy();
    }
}
