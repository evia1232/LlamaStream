package link.apbs.llamastream;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    configureWebView();
  }

  private void configureWebView() {
    WebView webView = getBridge() != null ? getBridge().getWebView() : null;
    if (webView == null) return;
    WebSettings settings = webView.getSettings();
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setDomStorageEnabled(true);
    settings.setJavaScriptEnabled(true);
  }

  private void keepWebViewAlive() {
    WebView webView = getBridge() != null ? getBridge().getWebView() : null;
    if (webView == null) return;
    webView.onResume();
    webView.resumeTimers();
  }

  @Override
  public void onPause() {
    super.onPause();
    // Capacitor pauses WebView timers/media — undo so audio keeps running
    keepWebViewAlive();
  }

  @Override
  public void onStop() {
    keepWebViewAlive();
    super.onStop();
  }

  @Override
  public void onResume() {
    super.onResume();
    keepWebViewAlive();
    // Nudge JS to resume <audio> after WebView media pause
    WebView webView = getBridge() != null ? getBridge().getWebView() : null;
    if (webView != null) {
      webView.postDelayed(() -> webView.evaluateJavascript(
          "(function(){try{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));}catch(e){}})();",
          null
      ), 80);
    }
  }

  @Override
  public void onBackPressed() {
    // Don't destroy the activity — send to background so playback continues
    moveTaskToBack(true);
  }
}
