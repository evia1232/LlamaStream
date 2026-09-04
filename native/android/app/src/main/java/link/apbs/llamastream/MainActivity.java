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

  @Override
  public void onPause() {
    super.onPause();
    // Capacitor pauses WebView timers on pause — resume so audio + queue keep working
    WebView webView = getBridge() != null ? getBridge().getWebView() : null;
    if (webView != null) {
      webView.onResume();
      webView.resumeTimers();
    }
  }

  @Override
  public void onStop() {
    // Keep WebView alive while backgrounded / screen off
    WebView webView = getBridge() != null ? getBridge().getWebView() : null;
    if (webView != null) {
      webView.onResume();
      webView.resumeTimers();
    }
    super.onStop();
  }

  @Override
  public void onBackPressed() {
    // Don't destroy the activity — send to background so playback continues
    moveTaskToBack(true);
  }
}
