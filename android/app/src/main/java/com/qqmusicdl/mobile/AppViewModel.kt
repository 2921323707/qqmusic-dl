package com.qqmusicdl.mobile

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.qqmusicdl.mobile.data.api.QqMusicClient
import com.qqmusicdl.mobile.data.download.DownloadRepository
import com.qqmusicdl.mobile.data.library.LibraryRepository
import com.qqmusicdl.mobile.data.metadata.CoverArtworkRepository
import com.qqmusicdl.mobile.data.model.AudioQuality
import com.qqmusicdl.mobile.data.model.LibraryEntry
import com.qqmusicdl.mobile.data.model.Track
import com.qqmusicdl.mobile.data.storage.MediaStoreExporter
import com.qqmusicdl.mobile.playback.PlayerController
import com.qqmusicdl.mobile.playback.PlaybackState
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class AppTab { SEARCH, LIBRARY, SETTINGS }

enum class DownloadStatus { IDLE, RESOLVING, DOWNLOADING, COMPLETED, FAILED }

data class SearchUiState(
    val query: String = "",
    val loading: Boolean = false,
    val results: List<Track> = emptyList(),
    val error: String? = null,
    val searched: Boolean = false,
)

data class DownloadUiState(
    val status: DownloadStatus = DownloadStatus.IDLE,
    val progress: Float = 0f,
    val message: String? = null,
)

data class MobileSettings(
    val selectedQuality: AudioQuality? = null,
    val fallback: Boolean = true,
    val exportToMusic: Boolean = true,
)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val client = QqMusicClient(application)
    private val exporter = MediaStoreExporter(application)
    private val library = LibraryRepository(application, exporter)
    private val downloads = DownloadRepository(application)
    private val metadata = CoverArtworkRepository()
    private val player = PlayerController(application, viewModelScope)
    private val downloadJobs = ConcurrentHashMap<String, Job>()

    private val _tab = MutableStateFlow(AppTab.SEARCH)
    val tab: StateFlow<AppTab> = _tab.asStateFlow()
    private val _search = MutableStateFlow(SearchUiState())
    val search: StateFlow<SearchUiState> = _search.asStateFlow()
    private val _settings = MutableStateFlow(MobileSettings())
    val settings: StateFlow<MobileSettings> = _settings.asStateFlow()
    private val _downloadStates = MutableStateFlow<Map<String, DownloadUiState>>(emptyMap())
    val downloadStates: StateFlow<Map<String, DownloadUiState>> = _downloadStates.asStateFlow()
    val libraryEntries: StateFlow<List<LibraryEntry>> = library.entries
    val playback: StateFlow<PlaybackState> = player.state

    private var searchJob: Job? = null

    init {
        viewModelScope.launch { library.initialize() }
    }

    fun selectTab(tab: AppTab) {
        _tab.value = tab
    }

    fun updateQuery(query: String) {
        _search.update { it.copy(query = query) }
    }

    fun search() {
        val query = _search.value.query.trim()
        if (query.isBlank()) return
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            _search.update {
                it.copy(loading = true, error = null, searched = true, results = emptyList())
            }
            runCatching { client.search(query) }
                .onSuccess { tracks ->
                    _search.update {
                        it.copy(loading = false, results = tracks, error = null)
                    }
                }
                .onFailure { error ->
                    if (error is CancellationException) throw error
                    _search.update {
                        it.copy(
                            loading = false,
                            error = error.message ?: "搜索失败，请稍后重试",
                        )
                    }
                }
        }
    }

    fun selectQuality(quality: AudioQuality?) {
        _settings.update { it.copy(selectedQuality = quality) }
    }

    fun setFallback(enabled: Boolean) {
        _settings.update { it.copy(fallback = enabled) }
    }

    fun setExportToMusic(enabled: Boolean) {
        _settings.update { it.copy(exportToMusic = enabled) }
    }

    fun download(track: Track) {
        if (downloadJobs[track.mid]?.isActive == true) return
        val settingsSnapshot = _settings.value
        downloadJobs[track.mid] = viewModelScope.launch {
            setDownloadState(track.mid, DownloadStatus.RESOLVING)
            val resolution = runCatching {
                client.resolve(track, settingsSnapshot.selectedQuality, settingsSnapshot.fallback)
            }.getOrElse { error ->
                if (error is CancellationException) throw error
                setDownloadState(
                    track.mid,
                    DownloadStatus.FAILED,
                    message = error.message ?: "无法解析下载地址",
                )
                return@launch
            }
            val source = resolution.source
            if (source == null) {
                setDownloadState(
                    track.mid,
                    DownloadStatus.FAILED,
                    message = resolution.userMessage(),
                )
                return@launch
            }
            if (library.contains(track.mid, source.quality.code)) {
                setDownloadState(
                    track.mid,
                    DownloadStatus.COMPLETED,
                    progress = 1f,
                    message = "这首歌曲已经在曲库中",
                )
                return@launch
            }

            setDownloadState(track.mid, DownloadStatus.DOWNLOADING)
            val result = runCatching {
                downloads.download(source) { progress ->
                    setDownloadState(
                        track.mid,
                        DownloadStatus.DOWNLOADING,
                        progress = progress,
                    )
                }
            }
            val downloaded = result.getOrElse { error ->
                if (error is CancellationException) throw error
                setDownloadState(
                    track.mid,
                    DownloadStatus.FAILED,
                    message = error.message ?: "下载失败",
                )
                return@launch
            }

            var entry = LibraryEntry(
                id = library.newId(),
                mid = track.mid,
                title = track.title,
                artist = track.artist,
                album = track.album,
                coverUrl = track.coverUrl,
                qualityCode = source.quality.code,
                qualityLabel = source.quality.label,
                localPath = downloaded.file.absolutePath,
                exportedUri = null,
                createdAtMillis = System.currentTimeMillis(),
            )
            library.add(entry)

            var message = "已保存到应用曲库"
            runCatching { metadata.enrich(downloaded.file, track) }
                .onFailure { if (it is CancellationException) throw it }
            if (settingsSnapshot.exportToMusic) {
                val exported = runCatching { exporter.export(entry) }
                    .onFailure {
                        if (it is CancellationException) throw it
                        Log.e("QqMusicDl", "Failed to export ${entry.title}", it)
                    }
                if (exported.isSuccess) {
                    val uri = exported.getOrNull()?.toString()
                    if (uri != null) {
                        entry = entry.copy(exportedUri = uri)
                        library.attachExport(entry.id, uri)
                        message = "已下载并保存到 Music/qqmusic-dl"
                    } else {
                        message = "已下载到应用曲库，当前系统版本不支持自动导出"
                    }
                } else {
                    message = "已下载到应用曲库，系统音乐目录导出失败"
                }
            }
            setDownloadState(
                track.mid,
                DownloadStatus.COMPLETED,
                progress = 1f,
                message = message,
            )
        }
    }

    fun cancelDownload(mid: String) {
        downloadJobs.remove(mid)?.cancel()
        setDownloadState(mid, DownloadStatus.IDLE)
    }

    fun deleteLibraryEntry(entry: LibraryEntry) {
        viewModelScope.launch { library.remove(entry) }
    }

    fun play(entry: LibraryEntry) {
        player.play(entry)
    }

    fun togglePlayback() {
        player.toggle()
    }

    fun seekTo(positionMillis: Long) {
        player.seekTo(positionMillis)
    }

    fun releasePlayer() {
        player.release()
    }

    private fun setDownloadState(
        mid: String,
        status: DownloadStatus,
        progress: Float = 0f,
        message: String? = null,
    ) {
        _downloadStates.update {
            it + (mid to DownloadUiState(status, progress, message))
        }
    }

    override fun onCleared() {
        player.release()
        super.onCleared()
    }
}
