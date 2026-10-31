package com.qqmusicdl.mobile.data.download

import android.content.Context
import com.qqmusicdl.mobile.data.model.ResolvedSource
import com.qqmusicdl.mobile.data.storage.FileNameSanitizer
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import kotlin.coroutines.coroutineContext

data class DownloadedFile(
    val file: File,
    val suggestedName: String,
)

class DownloadRepository(private val context: Context) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    suspend fun download(
        source: ResolvedSource,
        onProgress: (Float) -> Unit,
    ): DownloadedFile = withContext(Dispatchers.IO) {
        val track = source.track
        val displayName = buildString {
            append(FileNameSanitizer.sanitize(track.artist, "Unknown artist"))
            append(" - ")
            append(FileNameSanitizer.sanitize(track.title, "Unknown track"))
            append(" [")
            append(source.quality.code)
            append("] - ")
            append(FileNameSanitizer.sanitize(track.mid, "track"))
            append(source.quality.extension)
        }
        val directory = File(context.filesDir, "downloads").apply { mkdirs() }
        val output = File(directory, displayName)
        val temporary = File(directory, "$displayName.part")
        if (temporary.exists()) temporary.delete()

        val request = Request.Builder()
            .url(source.url)
            .header("Referer", "https://y.qq.com/")
            .header("User-Agent", "Mozilla/5.0")
            .build()

        try {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IOException("Download failed with HTTP ${response.code}")
                }
                val body = response.body ?: throw IOException("Download response is empty")
                val total = body.contentLength()
                var downloaded = 0L
                body.byteStream().use { input ->
                    temporary.outputStream().buffered().use { outputStream ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        while (true) {
                            coroutineContext.ensureActive()
                            val read = input.read(buffer)
                            if (read < 0) break
                            outputStream.write(buffer, 0, read)
                            downloaded += read
                            if (total > 0) {
                                onProgress((downloaded.toFloat() / total).coerceIn(0f, 1f))
                            }
                        }
                    }
                }
                if (downloaded <= 0) throw IOException("Downloaded file is empty")
            }
            if (output.exists()) output.delete()
            if (!temporary.renameTo(output)) {
                temporary.copyTo(output, overwrite = true)
                temporary.delete()
            }
            onProgress(1f)
            DownloadedFile(output, displayName)
        } catch (error: Exception) {
            temporary.delete()
            throw error
        }
    }
}
