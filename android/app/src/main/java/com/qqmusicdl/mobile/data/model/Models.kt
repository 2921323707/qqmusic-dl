package com.qqmusicdl.mobile.data.model

import kotlinx.serialization.Serializable

enum class AudioQuality(
    val code: String,
    val label: String,
    val extension: String,
    val mimeType: String,
) {
    MP3_128("M500", "MP3 128", ".mp3", "audio/mpeg"),
    AAC_96("C400", "AAC 96", ".m4a", "audio/mp4"),
    AAC_48("C200", "AAC 48", ".m4a", "audio/mp4"),
}

data class Track(
    val mid: String,
    val title: String,
    val artist: String,
    val album: String,
    val albumMid: String,
    val mediaMid: String,
    val durationSeconds: Int,
    val coverUrl: String?,
    val availableQualities: List<AudioQuality>,
)

data class ResolvedSource(
    val track: Track,
    val quality: AudioQuality,
    val url: String,
)

data class ResolutionFailure(
    val quality: AudioQuality,
    val resultCode: Int?,
    val reason: String,
)

data class ResolutionResult(
    val source: ResolvedSource?,
    val failures: List<ResolutionFailure>,
) {
    fun userMessage(): String {
        if (source != null) return ""
        if (failures.isEmpty()) return "没有可用的标准音质"

        val restricted = failures.all { it.resultCode == ACCOUNT_OR_COPYRIGHT_RESTRICTION }
        if (restricted) {
            val qualities = failures.joinToString(" / ") { it.quality.label }
            return "$qualities 均不可用；${failures.first().reason}"
        }
        return failures.joinToString("；") { "${it.quality.label}: ${it.reason}" }
    }

    private companion object {
        const val ACCOUNT_OR_COPYRIGHT_RESTRICTION = 104003
    }
}

@Serializable
data class LibraryEntry(
    val id: String,
    val mid: String,
    val title: String,
    val artist: String,
    val album: String,
    val coverUrl: String?,
    val qualityCode: String,
    val qualityLabel: String,
    val localPath: String,
    val exportedUri: String?,
    val createdAtMillis: Long,
)

fun qualityChain(selected: AudioQuality?, fallback: Boolean): List<AudioQuality> {
    val ladder = listOf(AudioQuality.MP3_128, AudioQuality.AAC_96, AudioQuality.AAC_48)
    if (selected == null) return ladder
    if (!fallback) return listOf(selected)
    return ladder.drop(ladder.indexOf(selected).coerceAtLeast(0))
}
