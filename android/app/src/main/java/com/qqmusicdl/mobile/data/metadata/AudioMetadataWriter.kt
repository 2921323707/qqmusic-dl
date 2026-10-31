package com.qqmusicdl.mobile.data.metadata

import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class AudioTags(
    val title: String,
    val artist: String,
    val album: String,
)

data class CoverArtwork(
    val bytes: ByteArray,
    val mimeType: String,
)

object AudioMetadataWriter {
    suspend fun write(
        file: File,
        tags: AudioTags,
        cover: CoverArtwork?,
    ) = withContext(Dispatchers.IO) {
        val rewritten = when (file.extension.lowercase()) {
            "mp3" -> writeMp3(file.readBytes(), tags, cover)
            "m4a", "mp4" -> writeM4a(file.readBytes(), tags, cover)
            else -> return@withContext
        }
        val temporary = File(file.parentFile, "${file.name}.metadata")
        try {
            temporary.writeBytes(rewritten)
            if (!temporary.renameTo(file)) {
                temporary.copyTo(file, overwrite = true)
            }
        } finally {
            temporary.delete()
        }
    }

    internal fun writeMp3(
        audio: ByteArray,
        tags: AudioTags,
        cover: CoverArtwork?,
    ): ByteArray {
        val frames = ByteArrayOutputStream().apply {
            write(id3TextFrame("TIT2", tags.title))
            write(id3TextFrame("TPE1", tags.artist))
            write(id3TextFrame("TALB", tags.album))
            cover?.let { write(id3PictureFrame(it)) }
        }.toByteArray()
        val tag = ByteArrayOutputStream().apply {
            write("ID3".toByteArray(StandardCharsets.ISO_8859_1))
            write(3)
            write(0)
            write(0)
            write(syncSafeSize(frames.size))
            write(frames)
        }.toByteArray()
        val audioStart = id3TagSize(audio)
        return tag + audio.copyOfRange(audioStart, audio.size)
    }

    internal fun writeM4a(
        audio: ByteArray,
        tags: AudioTags,
        cover: CoverArtwork?,
    ): ByteArray {
        val topLevel = parseBoxes(audio, 0, audio.size)
        if (topLevel.none { it.type == "moov" }) {
            throw IllegalArgumentException("M4A file has no moov box")
        }
        return concatenate(
            topLevel.map { box ->
                if (box.type == "moov") {
                    makeBox("moov", rewriteMoov(box.payload, tags, cover))
                } else {
                    box.bytes()
                }
            },
        )
    }

    private fun rewriteMoov(
        payload: ByteArray,
        tags: AudioTags,
        cover: CoverArtwork?,
    ): ByteArray {
        val boxes = parseBoxes(payload, 0, payload.size)
        val udta = boxes.firstOrNull { it.type == "udta" }
        val rewrittenUdta = udta?.let {
            rewriteUdta(it.payload, tags, cover)
        } ?: makeBox("meta", buildMeta(tags, cover))
        return concatenate(
            boxes.filterNot { it.type == "udta" }.map { it.bytes() } +
                makeBox("udta", rewrittenUdta),
        )
    }

    private fun rewriteUdta(
        payload: ByteArray,
        tags: AudioTags,
        cover: CoverArtwork?,
    ): ByteArray {
        val boxes = parseBoxes(payload, 0, payload.size)
        val meta = boxes.firstOrNull { it.type == "meta" }
        val rewrittenMeta = meta?.let {
            rewriteMeta(it.payload, tags, cover)
        } ?: buildMeta(tags, cover)
        return concatenate(
            boxes.filterNot { it.type == "meta" }.map { it.bytes() } +
                makeBox("meta", rewrittenMeta),
        )
    }

    private fun rewriteMeta(
        payload: ByteArray,
        tags: AudioTags,
        cover: CoverArtwork?,
    ): ByteArray {
        if (payload.size < 4) throw IllegalArgumentException("Invalid M4A meta box")
        val flags = payload.copyOfRange(0, 4)
        val boxes = parseBoxes(payload, 4, payload.size)
        val ilst = boxes.firstOrNull { it.type == "ilst" }
        val preserved = boxes.filterNot { it.type == "ilst" }
        val rewrittenIlst = ilst?.let {
            rewriteIlst(it.payload, tags, cover)
        } ?: buildIlst(tags, cover)
        return concatenate(
            listOf(flags) +
                preserved.map { it.bytes() } +
                makeBox("ilst", rewrittenIlst),
        )
    }

    private fun buildMeta(
        tags: AudioTags,
        cover: CoverArtwork?,
    ): ByteArray {
        val handler = ByteArray(29).apply {
            "mdir".toByteArray(StandardCharsets.ISO_8859_1).copyInto(this, 8)
            byteArrayOf('n'.code.toByte(), 'u'.code.toByte(), 'l'.code.toByte(), 'l'.code.toByte(), 0)
                .copyInto(this, 24)
        }
        return concatenate(
            listOf(
                ByteArray(4),
                makeBox("hdlr", handler),
                makeBox("ilst", buildIlst(tags, cover)),
            ),
        )
    }

    private fun rewriteIlst(
        payload: ByteArray,
        tags: AudioTags,
        cover: CoverArtwork?,
    ): ByteArray {
        val managedTypes = setOf("\u00A9nam", "\u00A9ART", "\u00A9alb", "covr")
        val preserved = parseBoxes(payload, 0, payload.size)
            .filterNot { it.type in managedTypes }
            .map { it.bytes() }
        return concatenate(preserved + buildMetadataItems(tags, cover))
    }

    private fun buildIlst(
        tags: AudioTags,
        cover: CoverArtwork?,
    ): ByteArray = concatenate(buildMetadataItems(tags, cover))

    private fun buildMetadataItems(
        tags: AudioTags,
        cover: CoverArtwork?,
    ): List<ByteArray> = buildList {
        add(metadataTextItem("\u00A9nam", tags.title))
        add(metadataTextItem("\u00A9ART", tags.artist))
        add(metadataTextItem("\u00A9alb", tags.album))
        cover?.let {
            val dataType = if (it.mimeType == "image/png") 14 else 13
            add(makeBox("covr", metadataDataAtom(dataType, it.bytes)))
        }
    }

    private fun metadataTextItem(type: String, value: String): ByteArray =
        makeBox(type, metadataDataAtom(1, value.toByteArray(StandardCharsets.UTF_8)))

    private fun metadataDataAtom(type: Int, value: ByteArray): ByteArray {
        val payload = ByteArrayOutputStream().apply {
            write(uint32(type))
            write(uint32(0))
            write(value)
        }.toByteArray()
        return makeBox("data", payload)
    }

    private fun id3TextFrame(id: String, value: String): ByteArray {
        val encoded = byteArrayOf(0xFF.toByte(), 0xFE.toByte()) +
            value.toByteArray(StandardCharsets.UTF_16LE)
        return id3Frame(id, byteArrayOf(1) + encoded)
    }

    private fun id3PictureFrame(cover: CoverArtwork): ByteArray {
        val payload = ByteArrayOutputStream().apply {
            write(0)
            write(cover.mimeType.toByteArray(StandardCharsets.ISO_8859_1))
            write(0)
            write(3)
            write(0)
            write(cover.bytes)
        }.toByteArray()
        return id3Frame("APIC", payload)
    }

    private fun id3Frame(id: String, payload: ByteArray): ByteArray =
        id.toByteArray(StandardCharsets.ISO_8859_1) +
            uint32(payload.size) +
            ByteArray(2) +
            payload

    private fun id3TagSize(audio: ByteArray): Int {
        if (audio.size < 10 ||
            audio[0] != 'I'.code.toByte() ||
            audio[1] != 'D'.code.toByte() ||
            audio[2] != '3'.code.toByte()
        ) {
            return 0
        }
        val size = ((audio[6].toInt() and 0x7F) shl 21) or
            ((audio[7].toInt() and 0x7F) shl 14) or
            ((audio[8].toInt() and 0x7F) shl 7) or
            (audio[9].toInt() and 0x7F)
        val footer = if ((audio[5].toInt() and 0x10) != 0) 10 else 0
        return (10 + size + footer).coerceAtMost(audio.size)
    }

    private fun parseBoxes(
        data: ByteArray,
        start: Int,
        end: Int,
    ): List<Box> {
        val boxes = mutableListOf<Box>()
        var position = start
        while (position < end) {
            require(end - position >= 8) { "Truncated M4A box header" }
            val compactSize = readUInt32(data, position)
            val type = String(data, position + 4, 4, StandardCharsets.ISO_8859_1)
            val headerSize = if (compactSize == 1) 16 else 8
            val size = when (compactSize) {
                0 -> end - position
                1 -> {
                    require(end - position >= 16) { "Truncated M4A large box header" }
                    readLong(data, position + 8).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
                }

                else -> compactSize
            }
            require(size >= headerSize && position + size <= end) {
                "Invalid M4A box size for $type"
            }
            boxes += Box(
                type = type,
                headerSize = headerSize,
                size = size,
                payload = data.copyOfRange(position + headerSize, position + size),
            )
            position += size
        }
        return boxes
    }

    private fun makeBox(type: String, payload: ByteArray): ByteArray =
        ByteArrayOutputStream().apply {
            write(uint32(payload.size + 8))
            write(type.toByteArray(StandardCharsets.ISO_8859_1))
            write(payload)
        }.toByteArray()

    private fun Box.bytes(): ByteArray {
        val boxType = type.toByteArray(StandardCharsets.ISO_8859_1)
        return if (headerSize == 8) {
            ByteArrayOutputStream().apply {
                write(uint32(size))
                write(boxType)
                write(payload)
            }.toByteArray()
        } else {
            ByteArrayOutputStream().apply {
                write(uint32(1))
                write(boxType)
                write(uint64(size.toLong()))
                write(payload)
            }.toByteArray()
        }
    }

    private fun readUInt32(data: ByteArray, offset: Int): Int =
        ByteBuffer.wrap(data, offset, 4).order(ByteOrder.BIG_ENDIAN).int

    private fun readLong(data: ByteArray, offset: Int): Long =
        ByteBuffer.wrap(data, offset, 8).order(ByteOrder.BIG_ENDIAN).long

    private fun uint32(value: Int): ByteArray =
        ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt(value).array()

    private fun uint64(value: Long): ByteArray =
        ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN).putLong(value).array()

    private fun syncSafeSize(value: Int): ByteArray = byteArrayOf(
        ((value shr 21) and 0x7F).toByte(),
        ((value shr 14) and 0x7F).toByte(),
        ((value shr 7) and 0x7F).toByte(),
        (value and 0x7F).toByte(),
    )

    private fun concatenate(parts: List<ByteArray>): ByteArray =
        ByteArrayOutputStream(parts.sumOf { it.size }).apply {
            parts.forEach(::write)
        }.toByteArray()

    private data class Box(
        val type: String,
        val headerSize: Int,
        val size: Int,
        val payload: ByteArray,
    )
}
