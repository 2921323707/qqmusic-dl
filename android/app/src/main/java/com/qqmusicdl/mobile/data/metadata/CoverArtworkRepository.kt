package com.qqmusicdl.mobile.data.metadata

import com.qqmusicdl.mobile.data.model.Track
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

class CoverArtworkRepository {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun enrich(file: File, track: Track) = withContext(Dispatchers.IO) {
        AudioMetadataWriter.write(
            file = file,
            tags = AudioTags(
                title = track.title,
                artist = track.artist,
                album = track.album,
            ),
            cover = downloadCover(track.coverUrl),
        )
    }

    private fun downloadCover(url: String?): CoverArtwork? {
        if (url.isNullOrBlank()) return null
        val request = Request.Builder()
            .url(url)
            .header("Referer", "https://y.qq.com/")
            .header("User-Agent", "Mozilla/5.0")
            .build()
        return runCatching {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use null
                val body = response.body ?: return@use null
                if (body.contentLength() > MAX_COVER_BYTES) return@use null
                val bytes = body.bytes()
                if (bytes.size > MAX_COVER_BYTES) return@use null
                val mime = sniffImageMime(bytes) ?: return@use null
                CoverArtwork(bytes, mime)
            }
        }.getOrNull()
    }

    private fun sniffImageMime(bytes: ByteArray): String? = when {
        bytes.size >= 3 &&
            bytes[0] == 0xFF.toByte() &&
            bytes[1] == 0xD8.toByte() &&
            bytes[2] == 0xFF.toByte() -> "image/jpeg"

        bytes.size >= 8 &&
            bytes.copyOfRange(0, 8).contentEquals(
                byteArrayOf(
                    0x89.toByte(),
                    0x50,
                    0x4E,
                    0x47,
                    0x0D,
                    0x0A,
                    0x1A,
                    0x0A,
                ),
            ) -> "image/png"

        else -> null
    }

    private companion object {
        const val MAX_COVER_BYTES = 10 * 1024 * 1024
    }
}
