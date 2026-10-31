package com.qqmusicdl.mobile.data.library

import com.qqmusicdl.mobile.data.model.LibraryEntry
import org.junit.Assert.assertEquals
import org.junit.Test

class LibraryJsonTest {
    @Test
    fun `round trip preserves entries`() {
        val entry = entry("one", 10)
        val decoded = LibraryJson.decode(LibraryJson.encode(listOf(entry)))

        assertEquals(listOf(entry), decoded)
    }

    @Test
    fun `corrupt JSON is treated as an empty library`() {
        assertEquals(emptyList<LibraryEntry>(), LibraryJson.decode("not-json"))
    }

    @Test
    fun `reconcile removes missing duplicates and sorts newest first`() {
        val reconciled = LibraryJson.reconcile(
            listOf(
                entry("missing", 100),
                entry("older", 10),
                entry("newer", 20),
                entry("newer", 30),
            ),
        ) { path -> !path.contains("missing") }

        assertEquals(listOf("newer", "older"), reconciled.map { it.id })
        assertEquals(1, reconciled.count { it.id == "newer" })
    }

    private fun entry(id: String, createdAt: Long) = LibraryEntry(
        id = id,
        mid = "mid-$id",
        title = "Title",
        artist = "Artist",
        album = "Album",
        coverUrl = null,
        qualityCode = "M500",
        qualityLabel = "MP3 128",
        localPath = "/tmp/$id.mp3",
        exportedUri = null,
        createdAtMillis = createdAt,
    )
}
