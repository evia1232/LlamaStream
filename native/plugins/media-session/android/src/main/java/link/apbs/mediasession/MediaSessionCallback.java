package link.apbs.mediasession;

import android.support.v4.media.session.MediaSessionCompat;

import com.getcapacitor.JSObject;

public class MediaSessionCallback extends MediaSessionCompat.Callback {
    private final MediaSessionPlugin plugin;

    MediaSessionCallback(MediaSessionPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public void onPlay() {
        plugin.actionCallback("play");
    }

    @Override
    public void onPause() {
        plugin.actionCallback("pause");
    }

    @Override
    public void onSeekTo(long pos) {
        JSObject data = new JSObject();
        data.put("seekTime", pos / 1000.0);
        plugin.actionCallback("seekto", data);
    }

    @Override
    public void onSkipToPrevious() {
        plugin.actionCallback("previoustrack");
    }

    @Override
    public void onSkipToNext() {
        plugin.actionCallback("nexttrack");
    }

    @Override
    public void onStop() {
        plugin.actionCallback("stop");
    }

    @Override
    public void onCustomAction(String action, android.os.Bundle extras) {
        if ("like".equals(action)) {
            plugin.actionCallback("like");
        }
    }
}
