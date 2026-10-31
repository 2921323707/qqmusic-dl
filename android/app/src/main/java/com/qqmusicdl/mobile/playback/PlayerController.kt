package com.qqmusicdl.mobile.playback

import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.qqmusicdl.mobile.data.model.LibraryEntry
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class PlaybackState(
    val current: LibraryEntry? = null,
    val isPlaying: Boolean = false,
    val positionMillis: Long = 0L,
    val durationMillis: Long = 0L,
)

class PlayerController(
    context: Context,
    private val scope: CoroutineScope,
) {
    private val player = ExoPlayer.Builder(context).build()
    private val _state = MutableStateFlow(PlaybackState())
    val state: StateFlow<PlaybackState> = _state.asStateFlow()

    init {
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                updateState(isPlaying = isPlaying)
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                updateState()
            }
        })
        scope.launch {
            while (isActive) {
                updateState()
                delay(500)
            }
        }
    }

    fun play(entry: LibraryEntry) {
        val file = File(entry.localPath)
        if (!file.isFile) return
        if (_state.value.current?.id != entry.id) {
            player.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
            player.prepare()
        }
        _state.value = _state.value.copy(current = entry)
        player.play()
        updateState()
    }

    fun toggle() {
        if (player.isPlaying) player.pause() else player.play()
        updateState()
    }

    fun seekTo(positionMillis: Long) {
        player.seekTo(positionMillis.coerceAtLeast(0L))
        updateState()
    }

    fun release() {
        player.release()
    }

    private fun updateState(isPlaying: Boolean = player.isPlaying) {
        val duration = player.duration.takeIf { it > 0L } ?: 0L
        _state.value = _state.value.copy(
            isPlaying = isPlaying,
            positionMillis = player.currentPosition.coerceAtLeast(0L),
            durationMillis = duration,
        )
    }
}
