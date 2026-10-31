package com.qqmusicdl.mobile.data.storage

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import com.qqmusicdl.mobile.data.model.LibraryEntry
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class MediaStoreExporter(private val context: Context) {
    suspend fun export(entry: LibraryEntry): Uri? = withContext(Dispatchers.IO) {
        val localFile = File(entry.localPath)
        if (!localFile.isFile) throw IOException("Local audio file is missing")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.WRITE_EXTERNAL_STORAGE,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return@withContext null
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            val directory = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC),
                "qqmusic-dl",
            )
            val destination = File(directory, localFile.name)
            val resolver = context.contentResolver
            val values = baseValues(entry, localFile).apply {
                put(MediaStore.Audio.Media.DATA, destination.absolutePath)
            }
            val uri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values)
            if (uri != null) {
                try {
                    resolver.openOutputStream(uri)?.use { output ->
                        localFile.inputStream().use { input -> input.copyTo(output) }
                    } ?: throw IOException("Could not open the MediaStore item")
                    MediaScannerConnection.scanFile(
                        context,
                        arrayOf(destination.absolutePath),
                        arrayOf(mimeType(localFile.extension)),
                        null,
                    )
                    return@withContext uri
                } catch (error: Exception) {
                    resolver.delete(uri, null, null)
                    throw error
                }
            }

            if (!directory.exists() && !directory.mkdirs()) {
                throw IOException("Could not create the system music directory")
            }
            localFile.copyTo(destination, overwrite = true)
            MediaScannerConnection.scanFile(
                context,
                arrayOf(destination.absolutePath),
                arrayOf(mimeType(localFile.extension)),
                null,
            )
            return@withContext Uri.fromFile(destination)
        }

        val values = baseValues(entry, localFile).apply {
            put(MediaStore.Audio.Media.RELATIVE_PATH, "Music/qqmusic-dl")
            put(MediaStore.Audio.Media.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("Could not create a MediaStore item")
        try {
            resolver.openOutputStream(uri)?.use { output ->
                localFile.inputStream().use { input -> input.copyTo(output) }
            } ?: throw IOException("Could not open the MediaStore item")
            resolver.update(
                uri,
                ContentValues().apply {
                    put(MediaStore.Audio.Media.IS_PENDING, 0)
                },
                null,
                null,
            )
            uri
        } catch (error: Exception) {
            resolver.delete(uri, null, null)
            throw error
        }
    }

    private fun baseValues(
        entry: LibraryEntry,
        localFile: File,
    ): ContentValues = ContentValues().apply {
        put(MediaStore.Audio.Media.DISPLAY_NAME, localFile.name)
        put(MediaStore.Audio.Media.TITLE, entry.title)
        put(MediaStore.Audio.Media.ARTIST, entry.artist)
        put(MediaStore.Audio.Media.ALBUM_ARTIST, entry.artist)
        put(MediaStore.Audio.Media.ALBUM, entry.album)
        put(MediaStore.Audio.Media.MIME_TYPE, mimeType(localFile.extension))
        put(MediaStore.Audio.Media.IS_MUSIC, 1)
    }

    fun delete(uriString: String?, displayName: String? = null) {
        if (uriString.isNullOrBlank()) return
        runCatching {
            val uri = Uri.parse(uriString)
            if (uri.scheme == "file") {
                deleteExportedFile(uri.path)
            } else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                val mediaPath = runCatching {
                    context.contentResolver.query(
                        uri,
                        arrayOf(MediaStore.Audio.Media.DATA),
                        null,
                        null,
                        null,
                    )?.use { cursor ->
                        if (cursor.moveToFirst()) cursor.getString(0) else null
                    }
                }.getOrNull()
                val fallbackPath = displayName
                    ?.takeIf(String::isNotBlank)
                    ?.let { exportedFile(it).absolutePath }
                deleteExportedFile(mediaPath ?: fallbackPath)
                runCatching { context.contentResolver.delete(uri, null, null) }
            } else {
                context.contentResolver.delete(uri, null, null)
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun exportedFile(displayName: String): File {
        val exportDirectory = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC),
            "qqmusic-dl",
        )
        return File(exportDirectory, File(displayName).name)
    }

    @Suppress("DEPRECATION")
    private fun deleteExportedFile(path: String?) {
        if (path.isNullOrBlank()) return
        val exportDirectory = exportedFile("").parentFile!!.canonicalFile
        val exportedFile = File(path).canonicalFile
        if (!exportedFile.toPath().startsWith(exportDirectory.toPath())) return
        if (exportedFile.delete()) {
            MediaScannerConnection.scanFile(context, arrayOf(exportedFile.absolutePath), null, null)
        }
    }

    private fun mimeType(extension: String): String = when (extension.lowercase()) {
        "mp3" -> "audio/mpeg"
        "m4a", "mp4" -> "audio/mp4"
        "flac" -> "audio/flac"
        "ogg" -> "audio/ogg"
        else -> "audio/*"
    }
}
