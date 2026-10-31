package com.qqmusicdl.mobile.data.library

import android.content.Context
import com.qqmusicdl.mobile.data.model.LibraryEntry
import com.qqmusicdl.mobile.data.storage.MediaStoreExporter
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class LibraryRepository(
    private val context: Context,
    private val exporter: MediaStoreExporter,
) {
    private val mutex = Mutex()
    private val file = File(context.filesDir, "library.json")
    private val _entries = MutableStateFlow<List<LibraryEntry>>(emptyList())
    val entries: StateFlow<List<LibraryEntry>> = _entries.asStateFlow()

    suspend fun initialize() = mutex.withLock {
        val loaded = if (file.exists()) LibraryJson.decode(file.readText()) else emptyList()
        val valid = LibraryJson.reconcile(loaded) { File(it).isFile }
        _entries.value = valid
        save(valid)
    }

    suspend fun contains(mid: String, qualityCode: String): Boolean =
        _entries.value.any { it.mid == mid && it.qualityCode == qualityCode }

    suspend fun add(entry: LibraryEntry) = mutex.withLock {
        val updated = (listOf(entry) + _entries.value)
            .distinctBy { "${it.mid}:${it.qualityCode}" }
        _entries.value = updated
        save(updated)
    }

    suspend fun remove(entry: LibraryEntry, deleteExport: Boolean = true) = mutex.withLock {
        val exportedName = File(entry.localPath).name
        File(entry.localPath).delete()
        if (deleteExport) exporter.delete(entry.exportedUri, exportedName)
        val updated = _entries.value.filterNot { it.id == entry.id }
        _entries.value = updated
        save(updated)
    }

    suspend fun attachExport(entryId: String, uri: String?) = mutex.withLock {
        val updated = _entries.value.map {
            if (it.id == entryId) it.copy(exportedUri = uri) else it
        }
        _entries.value = updated
        save(updated)
    }

    private suspend fun save(entries: List<LibraryEntry>) = withContext(Dispatchers.IO) {
        val temporary = File(file.parentFile, "${file.name}.tmp")
        temporary.writeText(LibraryJson.encode(entries))
        try {
            Files.move(
                temporary.toPath(),
                file.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        } catch (_: Exception) {
            Files.move(
                temporary.toPath(),
                file.toPath(),
                StandardCopyOption.REPLACE_EXISTING,
            )
        }
    }

    fun newId(): String = UUID.randomUUID().toString()
}
