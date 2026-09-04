package link.apbs.mediasession;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
        name = "MediaSession",
        permissions = {
                @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
        }
)
public class MediaSessionPlugin extends Plugin {
    private static final String TAG = "MediaSessionPlugin";

    private String title = "";
    private String artist = "";
    private String album = "";
    private Bitmap artwork = null;
    private String artworkUrl = "";
    private String playbackState = "none";
    private double duration = 0.0;
    private double position = 0.0;
    private double playbackRate = 1.0;
    private boolean liked = false;

    private final Map<String, PluginCall> actionHandlers = new HashMap<>();
    private MediaSessionService service = null;
    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName componentName, IBinder iBinder) {
            MediaSessionService.LocalBinder binder = (MediaSessionService.LocalBinder) iBinder;
            service = binder.getService();
            Intent intent = getContext().getPackageManager()
                    .getLaunchIntentForPackage(getContext().getPackageName());
            if (intent == null) {
                intent = new Intent(getActivity(), getActivity().getClass());
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            service.connectAndInitialize(MediaSessionPlugin.this, intent);
            pushAllToService();
        }

        @Override
        public void onServiceDisconnected(ComponentName componentName) {
            service = null;
        }
    };

    private void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (getActivity() != null) {
            ActivityCompat.requestPermissions(
                    getActivity(),
                    new String[]{ Manifest.permission.POST_NOTIFICATIONS },
                    4401
            );
        }
    }

    public void startMediaService() {
        ensureNotificationPermission();
        Intent intent = new Intent(getActivity(), MediaSessionService.class);
        ContextCompat.startForegroundService(getContext(), intent);
        getContext().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
    }

    private void pushAllToService() {
        if (service == null) return;
        service.setTitle(title);
        service.setArtist(artist);
        service.setAlbum(album);
        service.setArtwork(artwork);
        service.setLiked(liked);
        service.setDuration(Math.round(duration * 1000));
        service.setPosition(Math.round(position * 1000));
        float speed = playbackRate == 0.0 ? 1.0F : (float) playbackRate;
        service.setPlaybackSpeed(speed);
        if ("playing".equals(playbackState)) {
            service.setPlaybackState(PlaybackStateCompat.STATE_PLAYING);
        } else if ("paused".equals(playbackState)) {
            service.setPlaybackState(PlaybackStateCompat.STATE_PAUSED);
        } else {
            service.setPlaybackState(PlaybackStateCompat.STATE_NONE);
        }
        service.update();
    }

    private Bitmap decodeArtwork(String url) {
        try {
            if (url == null || url.isEmpty()) return null;
            if (url.startsWith("http://") || url.startsWith("https://")) {
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setDoInput(true);
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.connect();
                try (InputStream inputStream = connection.getInputStream()) {
                    Bitmap raw = BitmapFactory.decodeStream(inputStream);
                    if (raw == null) return null;
                    // Keep notification bitmap reasonably sized
                    int max = 512;
                    if (raw.getWidth() <= max && raw.getHeight() <= max) return raw;
                    float scale = Math.min((float) max / raw.getWidth(), (float) max / raw.getHeight());
                    return Bitmap.createScaledBitmap(
                            raw,
                            Math.round(raw.getWidth() * scale),
                            Math.round(raw.getHeight() * scale),
                            true
                    );
                }
            }
            int base64Index = url.indexOf(";base64,");
            if (base64Index != -1) {
                byte[] decoded = Base64.decode(url.substring(base64Index + 8), Base64.DEFAULT);
                return BitmapFactory.decodeByteArray(decoded, 0, decoded.length);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to load artwork: " + e.getMessage());
        }
        return null;
    }

    @PluginMethod
    public void setMetadata(PluginCall call) {
        title = call.getString("title", title);
        artist = call.getString("artist", artist);
        album = call.getString("album", album);
        if (call.getData().has("liked")) {
            Boolean likedVal = call.getBoolean("liked");
            if (likedVal != null) liked = likedVal;
        }

        JSArray artworkArray = call.getArray("artwork");
        String nextUrl = artworkUrl;
        if (artworkArray != null) {
            try {
                List<JSONObject> artworkList = artworkArray.toList();
                // Prefer largest listed artwork (last often biggest in our client)
                for (int i = artworkList.size() - 1; i >= 0; i--) {
                    String src = artworkList.get(i).optString("src", null);
                    if (src != null && !src.isEmpty()) {
                        nextUrl = src;
                        break;
                    }
                }
            } catch (JSONException e) {
                Log.w(TAG, "artwork parse failed", e);
            }
        }

        final String loadUrl = nextUrl;
        if (loadUrl != null && !loadUrl.equals(artworkUrl)) {
            artworkUrl = loadUrl;
            artworkExecutor.execute(() -> {
                Bitmap bmp = decodeArtwork(loadUrl);
                if (getActivity() == null) {
                    artwork = bmp;
                    return;
                }
                getActivity().runOnUiThread(() -> {
                    artwork = bmp;
                    if (service != null) pushAllToService();
                });
            });
        }

        if (service != null) pushAllToService();
        call.resolve();
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        playbackState = call.getString("playbackState", playbackState);
        boolean playback = "playing".equals(playbackState) || "paused".equals(playbackState);

        if (service == null && playback) {
            startMediaService();
        } else if (service != null && "none".equals(playbackState)) {
            try {
                getContext().unbindService(serviceConnection);
            } catch (Exception ignored) {
            }
            service = null;
        } else if (service != null) {
            pushAllToService();
        }
        call.resolve();
    }

    @PluginMethod
    public void setPositionState(PluginCall call) {
        duration = call.getDouble("duration", duration);
        position = call.getDouble("position", position);
        Double rate = call.getDouble("playbackRate");
        if (rate != null) playbackRate = rate;
        if (service != null) pushAllToService();
        call.resolve();
    }

    @PluginMethod
    public void setLiked(PluginCall call) {
        liked = Boolean.TRUE.equals(call.getBoolean("liked", false));
        if (service != null) pushAllToService();
        call.resolve();
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void setActionHandler(PluginCall call) {
        call.setKeepAlive(true);
        String action = call.getString("action");
        if (action != null) {
            actionHandlers.put(action, call);
        }
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        ensureNotificationPermission();
        call.resolve();
    }

    public void actionCallback(String action) {
        actionCallback(action, new JSObject());
    }

    public void actionCallback(String action, JSObject data) {
        PluginCall call = actionHandlers.get(action);
        if (call != null && !call.getCallbackId().equals(PluginCall.CALLBACK_ID_DANGLING)) {
            data.put("action", action);
            call.resolve(data);
        } else {
            Log.d(TAG, "No handler for action " + action);
        }
    }

    @Override
    protected void handleOnDestroy() {
        artworkExecutor.shutdownNow();
        if (service != null) {
            try {
                getContext().unbindService(serviceConnection);
            } catch (Exception ignored) {
            }
            service = null;
        }
        super.handleOnDestroy();
    }
}
