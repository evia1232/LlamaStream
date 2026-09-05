package link.apbs.llamastream;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private boolean batteryPromptShown = false;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    configureWebView();
    // Ask early — JS bridge may load later; music apps need unrestricted battery
    WebView webView = getBridge() != null ? getBridge().getWebView() : null;
    if (webView != null) {
      webView.postDelayed(this::requestBatteryUnrestricted, 1500);
    } else {
      getWindow().getDecorView().postDelayed(this::requestBatteryUnrestricted, 1500);
    }
  }

  private void configureWebView() {
    WebView webView = getBridge() != null ? getBridge().getWebView() : null;
    if (webView == null) return;
    WebSettings settings = webView.getSettings();
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setDomStorageEnabled(true);
    settings.setJavaScriptEnabled(true);
  }

  private void requestBatteryUnrestricted() {
    if (batteryPromptShown) return;
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
    PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
    if (pm == null) return;
    String pkg = getPackageName();
    if (pm.isIgnoringBatteryOptimizations(pkg)) return;
    batteryPromptShown = true;
    try {
      Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
      intent.setData(Uri.parse("package:" + pkg));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      startActivity(intent);
    } catch (Exception e) {
      try {
        Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(fallback);
      } catch (Exception ignored) {
      }
    }
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
    requestBatteryUnrestricted();
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
    moveTaskToBack(true);
  }
}
