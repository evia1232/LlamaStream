package link.apbs.mediasession;

import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.IBinder;
import android.os.Binder;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media.session.MediaButtonReceiver;

public class MediaSessionService extends Service {
    private static final int NOTIFICATION_ID = 42;
    private static final String CHANNEL_ID = "music24_playback";
    public static final String ACTION_LIKE = "link.apbs.mediasession.LIKE";

    private MediaSessionCompat mediaSession;
    private PlaybackStateCompat.Builder playbackStateBuilder;
    private MediaMetadataCompat.Builder mediaMetadataBuilder;
    private NotificationManager notificationManager;
    private NotificationCompat.Builder notificationBuilder;
    private MediaStyle notificationStyle;

    private int playbackState = PlaybackStateCompat.STATE_NONE;
    private String title = "";
    private String artist = "";
    private String album = "";
    private Bitmap artwork = null;
    private long duration = 0;
    private long position = 0;
    private float playbackSpeed = 1.0F;
    private boolean liked = false;

    private MediaSessionPlugin plugin;
    private final IBinder binder = new LocalBinder();

    public final class LocalBinder extends Binder {
        MediaSessionService getService() {
            return MediaSessionService.this;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        destroy();
        return super.onUnbind(intent);
    }

    public void connectAndInitialize(MediaSessionPlugin plugin, Intent launchIntent) {
        this.plugin = plugin;

        mediaSession = new MediaSessionCompat(this, "Music24MediaSession");
        mediaSession.setCallback(new MediaSessionCallback(plugin));
        mediaSession.setActive(true);

        playbackStateBuilder = new PlaybackStateCompat.Builder()
                .setActions(baseActions())
                .setState(PlaybackStateCompat.STATE_PAUSED, position, playbackSpeed);
        addLikeAction(playbackStateBuilder);
        mediaSession.setPlaybackState(playbackStateBuilder.build());

        mediaMetadataBuilder = new MediaMetadataCompat.Builder()
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);
        mediaSession.setMetadata(mediaMetadataBuilder.build());

        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Now Playing",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Music playback controls");
            channel.setShowBadge(false);
            notificationManager.createNotificationChannel(channel);
        }

        notificationStyle = new MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2);

        notificationBuilder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setStyle(notificationStyle)
                .setSmallIcon(R.drawable.ic_media_note)
                .setContentIntent(PendingIntent.getActivity(
                        getApplicationContext(),
                        0,
                        launchIntent,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                ))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setShowWhen(false);

        rebuildNotificationActions();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notificationBuilder.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notificationBuilder.build());
        }
    }

    private long baseActions() {
        return PlaybackStateCompat.ACTION_PLAY
                | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SEEK_TO
                | PlaybackStateCompat.ACTION_STOP;
    }

    private void addLikeAction(PlaybackStateCompat.Builder builder) {
        int icon = liked ? R.drawable.ic_media_like : R.drawable.ic_media_like_outline;
        builder.addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
                "like",
                liked ? "Unlike" : "Like",
                icon
        ).build());
    }

    private PendingIntent mediaAction(long action) {
        return MediaButtonReceiver.buildMediaButtonPendingIntent(this, action);
    }

    private PendingIntent likePendingIntent() {
        Intent intent = new Intent(this, MediaSessionService.class);
        intent.setAction(ACTION_LIKE);
        return PendingIntent.getService(
                this,
                99,
                intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    @SuppressLint("RestrictedApi")
    private void rebuildNotificationActions() {
        if (notificationBuilder == null) return;
        notificationBuilder.mActions.clear();

        notificationBuilder.addAction(new NotificationCompat.Action(
                R.drawable.ic_media_prev,
                "Previous",
                mediaAction(PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
        ));

        boolean playing = playbackState == PlaybackStateCompat.STATE_PLAYING;
        notificationBuilder.addAction(new NotificationCompat.Action(
                playing ? R.drawable.ic_media_pause : R.drawable.ic_media_play,
                playing ? "Pause" : "Play",
                mediaAction(PlaybackStateCompat.ACTION_PLAY_PAUSE)
        ));

        notificationBuilder.addAction(new NotificationCompat.Action(
                R.drawable.ic_media_next,
                "Next",
                mediaAction(PlaybackStateCompat.ACTION_SKIP_TO_NEXT)
        ));

        notificationBuilder.addAction(new NotificationCompat.Action(
                liked ? R.drawable.ic_media_like : R.drawable.ic_media_like_outline,
                liked ? "Unlike" : "Like",
                likePendingIntent()
        ));

        if (notificationStyle != null) {
            notificationStyle.setShowActionsInCompactView(0, 1, 2);
            notificationBuilder.setStyle(notificationStyle);
        }
    }

    public void destroy() {
        try {
            stopForeground(true);
        } catch (Exception ignored) {
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        stopSelf();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_LIKE.equals(intent.getAction())) {
            if (plugin != null) plugin.actionCallback("like");
            return START_STICKY;
        }
        if (mediaSession != null) {
            MediaButtonReceiver.handleIntent(mediaSession, intent);
        }
        return START_STICKY;
    }

    public void setPlaybackState(int playbackState) {
        this.playbackState = playbackState;
    }

    public void setTitle(String title) {
        this.title = title != null ? title : "";
    }

    public void setArtist(String artist) {
        this.artist = artist != null ? artist : "";
    }

    public void setAlbum(String album) {
        this.album = album != null ? album : "";
    }

    public void setArtwork(Bitmap artwork) {
        this.artwork = artwork;
    }

    public void setDuration(long duration) {
        this.duration = Math.max(0, duration);
    }

    public void setPosition(long position) {
        this.position = Math.max(0, position);
    }

    public void setPlaybackSpeed(float playbackSpeed) {
        this.playbackSpeed = playbackSpeed > 0 ? playbackSpeed : 1.0F;
    }

    public void setLiked(boolean liked) {
        this.liked = liked;
    }

    public void update() {
        if (mediaSession == null || playbackStateBuilder == null || mediaMetadataBuilder == null) {
            return;
        }

        playbackStateBuilder = new PlaybackStateCompat.Builder()
                .setActions(baseActions())
                .setState(this.playbackState, this.position, this.playbackSpeed);
        addLikeAction(playbackStateBuilder);
        mediaSession.setPlaybackState(playbackStateBuilder.build());

        mediaMetadataBuilder
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
                .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork)
                .putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, artwork)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);
        mediaSession.setMetadata(mediaMetadataBuilder.build());

        rebuildNotificationActions();
        notificationBuilder
                .setContentTitle(title)
                .setContentText(artist)
                .setSubText(album)
                .setLargeIcon(artwork)
                .setOngoing(playbackState == PlaybackStateCompat.STATE_PLAYING);

        notificationManager.notify(NOTIFICATION_ID, notificationBuilder.build());
    }
}
