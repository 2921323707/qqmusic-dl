package com.qqmusicdl.mobile.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import coil.compose.SubcomposeAsyncImageContent
import com.qqmusicdl.mobile.AppTab
import com.qqmusicdl.mobile.AppViewModel
import com.qqmusicdl.mobile.BuildConfig
import com.qqmusicdl.mobile.DownloadStatus
import com.qqmusicdl.mobile.DownloadUiState
import com.qqmusicdl.mobile.MobileSettings
import com.qqmusicdl.mobile.R
import com.qqmusicdl.mobile.SearchUiState
import com.qqmusicdl.mobile.data.model.AudioQuality
import com.qqmusicdl.mobile.data.model.LibraryEntry
import com.qqmusicdl.mobile.data.model.Track
import com.qqmusicdl.mobile.playback.PlaybackState
import com.qqmusicdl.mobile.ui.theme.Hairline
import com.qqmusicdl.mobile.ui.theme.Ink
import com.qqmusicdl.mobile.ui.theme.MutedInk
import com.qqmusicdl.mobile.ui.theme.Page
import com.qqmusicdl.mobile.ui.theme.PaleBlue
import com.qqmusicdl.mobile.ui.theme.PalePink
import com.qqmusicdl.mobile.ui.theme.SoftBlue
import com.qqmusicdl.mobile.ui.theme.SoftPink
import kotlin.math.roundToInt

@Composable
fun MobileApp(viewModel: AppViewModel) {
    val tab by viewModel.tab.collectAsState()
    val search by viewModel.search.collectAsState()
    val settings by viewModel.settings.collectAsState()
    val downloadStates by viewModel.downloadStates.collectAsState()
    val entries by viewModel.libraryEntries.collectAsState()
    val playback by viewModel.playback.collectAsState()

    Scaffold(
        containerColor = Page,
        topBar = { ProductHeader() },
        bottomBar = {
            Column {
                playback.current?.let {
                    MiniPlayer(
                        playback = playback,
                        onToggle = viewModel::togglePlayback,
                        onSeek = viewModel::seekTo,
                    )
                }
                AppNavigation(
                    selected = tab,
                    onSelect = viewModel::selectTab,
                )
            }
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when (tab) {
                AppTab.SEARCH -> SearchScreen(
                    state = search,
                    settings = settings,
                    downloadStates = downloadStates,
                    onQueryChange = viewModel::updateQuery,
                    onSearch = viewModel::search,
                    onQualityChange = viewModel::selectQuality,
                    onDownload = viewModel::download,
                    onCancel = viewModel::cancelDownload,
                )

                AppTab.LIBRARY -> LibraryScreen(
                    entries = entries,
                    playback = playback,
                    onPlay = viewModel::play,
                    onDelete = viewModel::deleteLibraryEntry,
                )

                AppTab.SETTINGS -> SettingsScreen(
                    settings = settings,
                    onQualityChange = viewModel::selectQuality,
                    onFallbackChange = viewModel::setFallback,
                    onExportChange = viewModel::setExportToMusic,
                )
            }
        }
    }
}

@Composable
private fun ProductHeader() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Page)
            .statusBarsPadding()
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(
            painter = painterResource(R.drawable.ic_launcher_art),
            contentDescription = null,
            modifier = Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(8.dp)),
        )
        Spacer(Modifier.width(10.dp))
        Column {
            Text(
                text = "qqmusic-dl",
                color = Ink,
                fontSize = 20.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "mobile",
                color = MutedInk,
                fontSize = 11.sp,
                letterSpacing = 0.sp,
            )
        }
    }
}

@Composable
private fun SearchScreen(
    state: SearchUiState,
    settings: MobileSettings,
    downloadStates: Map<String, DownloadUiState>,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onQualityChange: (AudioQuality?) -> Unit,
    onDownload: (Track) -> Unit,
    onCancel: (String) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 16.dp,
            top = 8.dp,
            end = 16.dp,
            bottom = 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            OutlinedTextField(
                value = state.query,
                onValueChange = onQueryChange,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("搜索歌曲、歌手或专辑") },
                leadingIcon = {
                    Icon(Icons.Default.Search, contentDescription = null)
                },
                trailingIcon = {
                    if (state.loading) {
                        CircularProgressIndicator(
                            modifier = Modifier
                                .padding(12.dp)
                                .size(20.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        IconButton(onClick = onSearch) {
                            Icon(Icons.Default.Search, contentDescription = "搜索")
                        }
                    }
                },
                singleLine = true,
                shape = RoundedCornerShape(8.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onSearch() }),
            )
        }
        item {
            QualityPicker(
                selected = settings.selectedQuality,
                onSelect = onQualityChange,
            )
        }
        state.error?.let { error ->
            item {
                MessagePanel(
                    message = error,
                    error = true,
                )
            }
        }
        if (state.searched && !state.loading && state.error == null && state.results.isEmpty()) {
            item {
                EmptyPanel(
                    icon = Icons.Default.Search,
                    title = "没有找到歌曲",
                    subtitle = "换一个关键词再试",
                )
            }
        }
        items(state.results, key = { it.mid }) { track ->
            SongRow(
                track = track,
                download = downloadStates[track.mid] ?: DownloadUiState(),
                onDownload = { onDownload(track) },
                onCancel = { onCancel(track.mid) },
            )
        }
    }
}

@Composable
private fun QualityPicker(
    selected: AudioQuality?,
    onSelect: (AudioQuality?) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Default.Tune,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MutedInk,
            )
            Spacer(Modifier.width(6.dp))
            Text(
                text = "下载音质",
                color = MutedInk,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(
                selected = selected == null,
                onClick = { onSelect(null) },
                label = { Text("自动") },
            )
            AudioQuality.entries.forEach { quality ->
                FilterChip(
                    selected = selected == quality,
                    onClick = { onSelect(quality) },
                    label = { Text(quality.label) },
                )
            }
        }
    }
}

@Composable
private fun SongRow(
    track: Track,
    download: DownloadUiState,
    onDownload: () -> Unit,
    onCancel: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = Color.White,
    ) {
        Column {
            Row(
                modifier = Modifier.padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CoverArt(
                    url = track.coverUrl,
                    modifier = Modifier.size(54.dp),
                )
                Spacer(Modifier.width(11.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = track.title,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = Ink,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                    )
                    Spacer(Modifier.height(3.dp))
                    Text(
                        text = listOf(track.artist, track.album)
                            .filter { it.isNotBlank() }
                            .joinToString(" · "),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = MutedInk,
                        fontSize = 12.sp,
                    )
                    Spacer(Modifier.height(5.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        track.availableQualities.take(3).forEach { quality ->
                            QualityBadge(quality.label)
                        }
                    }
                }
                Spacer(Modifier.width(6.dp))
                DownloadAction(
                    state = download,
                    onDownload = onDownload,
                    onCancel = onCancel,
                )
            }
            when (download.status) {
                DownloadStatus.RESOLVING -> LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = SoftBlue,
                    trackColor = PaleBlue,
                )

                DownloadStatus.DOWNLOADING -> LinearProgressIndicator(
                    progress = { download.progress },
                    modifier = Modifier.fillMaxWidth(),
                    color = SoftBlue,
                    trackColor = PaleBlue,
                )

                else -> Unit
            }
            download.message?.let { message ->
                Text(
                    text = message,
                    modifier = Modifier.padding(
                        start = 12.dp,
                        end = 12.dp,
                        bottom = 10.dp,
                    ),
                    color = if (download.status == DownloadStatus.FAILED) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MutedInk
                    },
                    fontSize = 11.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun DownloadAction(
    state: DownloadUiState,
    onDownload: () -> Unit,
    onCancel: () -> Unit,
) {
    Box(
        modifier = Modifier.size(44.dp),
        contentAlignment = Alignment.Center,
    ) {
        when (state.status) {
            DownloadStatus.RESOLVING -> {
                IconButton(onClick = onCancel) {
                    Icon(Icons.Default.Cancel, contentDescription = "取消")
                }
            }

            DownloadStatus.DOWNLOADING -> {
                IconButton(onClick = onCancel) {
                    CircularProgressIndicator(
                        progress = { state.progress },
                        modifier = Modifier.size(28.dp),
                        strokeWidth = 3.dp,
                        color = SoftBlue,
                        trackColor = PaleBlue,
                    )
                }
            }

            DownloadStatus.COMPLETED -> {
                Icon(
                    Icons.Default.CheckCircle,
                    contentDescription = "已完成",
                    tint = SoftBlue,
                )
            }

            DownloadStatus.FAILED -> {
                IconButton(onClick = onDownload) {
                    Icon(Icons.Default.Refresh, contentDescription = "重试")
                }
            }

            DownloadStatus.IDLE -> {
                IconButton(onClick = onDownload) {
                    Icon(
                        Icons.Default.Download,
                        contentDescription = "下载",
                        tint = SoftBlue,
                    )
                }
            }
        }
    }
}

@Composable
private fun LibraryScreen(
    entries: List<LibraryEntry>,
    playback: PlaybackState,
    onPlay: (LibraryEntry) -> Unit,
    onDelete: (LibraryEntry) -> Unit,
) {
    var pendingDelete by remember { mutableStateOf<LibraryEntry?>(null) }

    pendingDelete?.let { entry ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("删除本地文件？") },
            text = { Text("${entry.artist} - ${entry.title}") },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDelete(entry)
                        pendingDelete = null
                    },
                ) {
                    Text("删除")
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) {
                    Text("取消")
                }
            },
        )
    }

    if (entries.isEmpty()) {
        EmptyPanel(
            icon = Icons.Default.LibraryMusic,
            title = "曲库还是空的",
            subtitle = "下载完成的歌曲会保存在这里",
        )
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 16.dp,
            top = 8.dp,
            end = 16.dp,
            bottom = 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "本地曲库",
                    color = Ink,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = "${entries.size} 首",
                    color = MutedInk,
                    fontSize = 12.sp,
                )
            }
        }
        items(entries, key = { it.id }) { entry ->
            LibraryRow(
                entry = entry,
                isPlaying = playback.current?.id == entry.id && playback.isPlaying,
                onPlay = { onPlay(entry) },
                onDelete = { pendingDelete = entry },
            )
        }
    }
}

@Composable
private fun LibraryRow(
    entry: LibraryEntry,
    isPlaying: Boolean,
    onPlay: () -> Unit,
    onDelete: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onPlay),
        shape = RoundedCornerShape(8.dp),
        color = Color.White,
    ) {
        Row(
            modifier = Modifier.padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(contentAlignment = Alignment.Center) {
                CoverArt(
                    url = entry.coverUrl,
                    modifier = Modifier.size(52.dp),
                )
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = if (isPlaying) SoftBlue else Color(0xAA20242E),
                ) {
                    Icon(
                        imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier
                            .padding(5.dp)
                            .size(18.dp),
                    )
                }
            }
            Spacer(Modifier.width(11.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = entry.title,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = Ink,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    text = entry.artist,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MutedInk,
                    fontSize = 12.sp,
                )
                Spacer(Modifier.height(5.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    QualityBadge(entry.qualityLabel)
                    if (!entry.exportedUri.isNullOrBlank()) {
                        Icon(
                            Icons.Default.CloudDownload,
                            contentDescription = "已导出到系统音乐",
                            tint = SoftPink,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                }
            }
            IconButton(onClick = onDelete) {
                Icon(
                    Icons.Default.DeleteOutline,
                    contentDescription = "删除",
                    tint = MutedInk,
                )
            }
        }
    }
}

@Composable
private fun SettingsScreen(
    settings: MobileSettings,
    onQualityChange: (AudioQuality?) -> Unit,
    onFallbackChange: (Boolean) -> Unit,
    onExportChange: (Boolean) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "默认下载音质",
                    color = Ink,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                QualityPicker(
                    selected = settings.selectedQuality,
                    onSelect = onQualityChange,
                )
            }
        }
        item {
            SettingsSurface {
                SettingSwitchRow(
                    title = "自动降级",
                    subtitle = "所选音质不可用时尝试更低标准音质",
                    checked = settings.fallback,
                    onCheckedChange = onFallbackChange,
                )
                HorizontalDivider(color = Hairline)
                SettingSwitchRow(
                    title = "导出到系统音乐",
                    subtitle = "Music/qqmusic-dl",
                    checked = settings.exportToMusic,
                    onCheckedChange = onExportChange,
                )
            }
        }
        item {
            SettingsSurface {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "存储位置",
                        color = MutedInk,
                        fontSize = 12.sp,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = "应用私有目录 + 系统 Music 目录",
                        color = Ink,
                        fontSize = 14.sp,
                    )
                    Spacer(Modifier.height(10.dp))
                    HorizontalDivider(color = Hairline)
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = "qqmusic-dl mobile ${BuildConfig.VERSION_NAME}",
                        color = MutedInk,
                        fontSize = 12.sp,
                    )
                }
            }
        }
        item {
            MessagePanel(
                message = "未登录时仅使用已验证的公共标准音质；VIP 与高解析音质暂不在移动端开放。",
                error = false,
            )
        }
    }
}

@Composable
private fun SettingsSurface(content: @Composable () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = Color.White,
    ) {
        Column { content() }
    }
}

@Composable
private fun SettingSwitchRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                color = Ink,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(3.dp))
            Text(
                text = subtitle,
                color = MutedInk,
                fontSize = 12.sp,
            )
        }
        Spacer(Modifier.width(12.dp))
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun MiniPlayer(
    playback: PlaybackState,
    onToggle: () -> Unit,
    onSeek: (Long) -> Unit,
) {
    val entry = playback.current ?: return
    var dragPosition by remember(entry.id) {
        mutableFloatStateOf(playback.positionMillis.toFloat())
    }
    var isSeeking by remember(entry.id) { mutableStateOf(false) }
    val duration = playback.durationMillis.coerceAtLeast(1L)

    LaunchedEffect(playback.positionMillis, entry.id, isSeeking) {
        if (!isSeeking) {
            dragPosition = playback.positionMillis.toFloat()
        }
    }

    Surface(color = Color.White) {
        Column {
            HorizontalDivider(color = Hairline)
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CoverArt(
                    url = entry.coverUrl,
                    modifier = Modifier.size(42.dp),
                )
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = entry.title,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = Ink,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = entry.artist,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = MutedInk,
                        fontSize = 11.sp,
                    )
                }
                IconButton(onClick = onToggle) {
                    Icon(
                        imageVector = if (playback.isPlaying) {
                            Icons.Default.Pause
                        } else {
                            Icons.Default.PlayArrow
                        },
                        contentDescription = if (playback.isPlaying) "暂停" else "播放",
                        tint = SoftBlue,
                    )
                }
            }
            Slider(
                value = dragPosition.coerceIn(0f, duration.toFloat()),
                onValueChange = {
                    isSeeking = true
                    dragPosition = it
                },
                onValueChangeFinished = {
                    onSeek(dragPosition.toLong())
                    isSeeking = false
                },
                valueRange = 0f..duration.toFloat(),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(24.dp)
                    .padding(horizontal = 14.dp),
            )
        }
    }
}

@Composable
private fun AppNavigation(
    selected: AppTab,
    onSelect: (AppTab) -> Unit,
) {
    NavigationBar(
        containerColor = Color.White,
        tonalElevation = 0.dp,
        modifier = Modifier.navigationBarsPadding(),
    ) {
        NavigationBarItem(
            selected = selected == AppTab.SEARCH,
            onClick = { onSelect(AppTab.SEARCH) },
            icon = { Icon(Icons.Default.Search, contentDescription = null) },
            label = { Text("搜索") },
        )
        NavigationBarItem(
            selected = selected == AppTab.LIBRARY,
            onClick = { onSelect(AppTab.LIBRARY) },
            icon = { Icon(Icons.Default.LibraryMusic, contentDescription = null) },
            label = { Text("曲库") },
        )
        NavigationBarItem(
            selected = selected == AppTab.SETTINGS,
            onClick = { onSelect(AppTab.SETTINGS) },
            icon = { Icon(Icons.Default.Settings, contentDescription = null) },
            label = { Text("设置") },
        )
    }
}

@Composable
private fun CoverArt(url: String?, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(PaleBlue),
        contentAlignment = Alignment.Center,
    ) {
        if (url.isNullOrBlank()) {
            Icon(
                Icons.Default.MusicNote,
                contentDescription = null,
                tint = SoftBlue,
            )
        } else {
            SubcomposeAsyncImage(
                model = url,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                loading = {
                    Icon(
                        Icons.Default.MusicNote,
                        contentDescription = null,
                        tint = SoftBlue,
                    )
                },
                error = {
                    Icon(
                        Icons.Default.MusicNote,
                        contentDescription = null,
                        tint = SoftBlue,
                    )
                },
                success = { SubcomposeAsyncImageContent() },
            )
        }
    }
}

@Composable
private fun QualityBadge(text: String) {
    Surface(
        shape = RoundedCornerShape(4.dp),
        color = PalePink,
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp),
            color = Color(0xFF9B5E70),
            fontSize = 9.sp,
            maxLines = 1,
        )
    }
}

@Composable
private fun MessagePanel(message: String, error: Boolean) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = if (error) PalePink else PaleBlue,
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                imageVector = if (error) Icons.Default.ErrorOutline else Icons.Default.Tune,
                contentDescription = null,
                tint = if (error) MaterialTheme.colorScheme.error else SoftBlue,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = message,
                color = Ink,
                fontSize = 12.sp,
                lineHeight = 17.sp,
            )
        }
    }
}

@Composable
private fun EmptyPanel(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(28.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = PaleBlue,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = SoftBlue,
                    modifier = Modifier
                        .padding(14.dp)
                        .size(30.dp),
                )
            }
            Spacer(Modifier.height(14.dp))
            Text(
                text = title,
                color = Ink,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(5.dp))
            Text(
                text = subtitle,
                color = MutedInk,
                fontSize = 12.sp,
            )
        }
    }
}
