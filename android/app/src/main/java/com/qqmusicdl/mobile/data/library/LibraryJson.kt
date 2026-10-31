package com.qqmusicdl.mobile.data.library

import com.qqmusicdl.mobile.data.model.LibraryEntry
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
internal data class LibraryFile(
    val version: Int = 1,
    val entries: List<LibraryEntry> = emptyList(),
)

internal object LibraryJson {
    private val json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
    }

    fun decode(text: String): List<LibraryEntry> =
        runCatching {
            json.decodeFromString<LibraryFile>(text).entries
        }.getOrElse { emptyList() }

    fun encode(entries: List<LibraryEntry>): String =
        json.encodeToString(
            LibraryFile.serializer(),
            LibraryFile(entries = entries),
        )

    fun reconcile(
        entries: List<LibraryEntry>,
        fileExists: (String) -> Boolean,
    ): List<LibraryEntry> = entries
        .filter { fileExists(it.localPath) }
        .distinctBy { "${it.mid}:${it.qualityCode}" }
        .sortedByDescending { it.createdAtMillis }
}
