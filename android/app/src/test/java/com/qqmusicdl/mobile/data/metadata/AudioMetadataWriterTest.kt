package com.qqmusicdl.mobile.data.metadata

import java.nio.charset.StandardCharsets
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioMetadataWriterTest {
    private val tags = AudioTags("Title", "Artist", "Album")

    @Test
    fun `MP3 writes ID3 frames and retains audio bytes`() {
        val audio = byteArrayOf(0xFF.toByte(), 0xFB.toByte(), 1, 2, 3)
        val result = AudioMetadataWriter.writeMp3(audio, tags, null)

        assertEquals("ID3", String(result, 0, 3, StandardCharsets.ISO_8859_1))
        assertTrue(result.indexOfSubarray("TIT2") > 0)
        assertTrue(result.indexOfSubarray("TPE1") > 0)
        assertTrue(result.indexOfSubarray("TALB") > 0)
        assertArrayEquals(audio, result.copyOfRange(result.size - audio.size, result.size))
    }

    @Test
    fun `MP3 includes front cover picture`() {
        val coverBytes = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 9)
        val result = AudioMetadataWriter.writeMp3(
            byteArrayOf(0xFF.toByte(), 0xFB.toByte()),
            tags,
            CoverArtwork(coverBytes, "image/jpeg"),
        )

        val picture = result.indexOfSubarray("APIC")
        assertTrue(picture > 0)
        assertTrue(result.indexOfSubarray(coverBytes) > picture)
    }

    @Test
    fun `M4A adds metadata and cover atoms inside moov`() {
        val ftyp = box("ftyp", "M4A ".toByteArray(StandardCharsets.ISO_8859_1))
        val moov = box("moov", box("mvhd", ByteArray(12)))
        val coverBytes = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47)

        val result = AudioMetadataWriter.writeM4a(
            ftyp + moov,
            tags,
            CoverArtwork(coverBytes, "image/png"),
        )

        assertArrayEquals(ftyp, result.copyOfRange(0, ftyp.size))
        assertTrue(result.indexOfSubarray("udta") > 0)
        assertTrue(result.indexOfSubarray("meta") > 0)
        assertTrue(
            result.indexOfSubarray(
                "\u00A9nam".toByteArray(StandardCharsets.ISO_8859_1),
            ) > 0,
        )
        assertTrue(result.indexOfSubarray("covr") > 0)
    }

    private fun box(type: String, payload: ByteArray): ByteArray {
        val size = payload.size + 8
        return byteArrayOf(
            (size ushr 24).toByte(),
            (size ushr 16).toByte(),
            (size ushr 8).toByte(),
            size.toByte(),
        ) + type.toByteArray(StandardCharsets.ISO_8859_1) + payload
    }

    private fun ByteArray.indexOfSubarray(needle: String): Int =
        indexOfSubarray(needle.toByteArray(StandardCharsets.ISO_8859_1))

    private fun ByteArray.indexOfSubarray(needle: ByteArray): Int {
        if (needle.isEmpty() || needle.size > size) return -1
        for (start in 0..size - needle.size) {
            if (needle.indices.all { this[start + it] == needle[it] }) return start
        }
        return -1
    }
}
