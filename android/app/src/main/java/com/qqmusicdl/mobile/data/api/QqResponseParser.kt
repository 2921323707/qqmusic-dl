package com.qqmusicdl.mobile.data.api

import com.qqmusicdl.mobile.data.model.AudioQuality
import com.qqmusicdl.mobile.data.model.Track
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

data class PlaybackUrlLookup(
    val url: String?,
    val resultCode: Int?,
    val message: String?,
)

object QqResponseParser {
    private val json = Json { ignoreUnknownKeys = true }
    private val highlightTags = Regex("<[^>]+>")

    fun parseSearch(responseText: String): List<Track> {
        val root = json.parseToJsonElement(responseText).jsonObject
        val body = root.objectAt("req_0", "data", "body") ?: return emptyList()
        val list = firstArray(
            body.objectAt("item_song")?.get("items"),
            body.objectAt("item_song")?.get("list"),
            body.objectAt("song")?.get("list"),
            body.objectAt("songlist")?.get("list"),
        ) ?: return emptyList()

        return list.mapNotNull(::parseTrack).filter { it.mid.isNotBlank() }
    }

    fun parsePlaybackUrl(responseText: String, mid: String): PlaybackUrlLookup {
        val data = json.parseToJsonElement(responseText)
            .jsonObject.objectAt("req_0", "data")
            ?: return PlaybackUrlLookup(null, null, null)
        val item = data["midurlinfo"]?.jsonArray
            ?.mapNotNull { it as? JsonObject }
            ?.firstOrNull { it.text("songmid") == mid }
            ?: return PlaybackUrlLookup(null, null, null)
        val resultCode = item.int("result")
        val message = item.text("tips").ifBlank {
            data.text("msg").ifBlank { null }
        }
        val purl = item.text("purl")
        if (purl.isBlank()) {
            return PlaybackUrlLookup(null, resultCode, message)
        }
        val url = if (purl.startsWith("http://") || purl.startsWith("https://")) {
            purl.upgradeToHttps()
        } else {
            val sip = data["sip"]?.jsonArray?.firstOrNull()?.jsonPrimitive?.contentOrNull
                ?: "https://isure.stream.qqmusic.qq.com/"
            (sip.trimEnd('/') + "/" + purl.trimStart('/')).upgradeToHttps()
        }

        return PlaybackUrlLookup(url, resultCode, message)
    }

    private fun parseTrack(element: JsonElement): Track? {
        val item = element as? JsonObject ?: return null
        val album = item["album"] as? JsonObject
        val file = item["file"] as? JsonObject ?: JsonObject(emptyMap())
        val mid = item.text("mid").ifBlank { item.text("songmid") }
        if (mid.isBlank()) return null

        val title = item.text("title").ifBlank { item.text("name") }.stripHighlight()
        val artist = item["singer"]?.asArray()
            ?.mapNotNull { singer ->
                (singer as? JsonObject)?.text("name")?.ifBlank {
                    singer.text("title")
                }
            }
            ?.filter { it.isNotBlank() }
            ?.distinct()
            ?.joinToString(" / ")
            .orEmpty()
            .stripHighlight()
        val albumMid = album?.text("mid").orEmpty().ifBlank {
            album?.text("pmid").orEmpty()
        }
        val qualities = buildList {
            if (file.positiveLong("size_128mp3") > 0) add(AudioQuality.MP3_128)
            if (file.positiveLong("size_96aac") > 0) add(AudioQuality.AAC_96)
            if (file.positiveLong("size_48aac") > 0) add(AudioQuality.AAC_48)
        }

        return Track(
            mid = mid,
            title = title.ifBlank { "Unknown track" },
            artist = artist,
            album = album?.text("title").orEmpty().ifBlank {
                album?.text("name").orEmpty()
            }.stripHighlight(),
            albumMid = albumMid,
            mediaMid = file.text("media_mid").ifBlank { mid },
            durationSeconds = item["interval"]?.jsonPrimitive?.intOrNull
                ?: item["interval"]?.jsonPrimitive?.contentOrNull?.toIntOrNull()
                ?: 0,
            coverUrl = albumMid.takeIf { it.isNotBlank() }?.let {
                "https://y.gtimg.cn/music/photo_new/T002R300x300M000$it.jpg"
            },
            availableQualities = qualities,
        )
    }

    private fun firstArray(vararg values: JsonElement?): JsonArray? =
        values.filterIsInstance<JsonArray>().firstOrNull()

    private fun JsonElement.asArray(): JsonArray? = this as? JsonArray

    private fun JsonObject.text(key: String): String =
        this[key]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()

    private fun JsonObject.positiveLong(key: String): Long =
        this[key]?.jsonPrimitive?.longOrNull
            ?: this[key]?.jsonPrimitive?.contentOrNull?.toLongOrNull()
            ?: 0L

    private fun JsonObject.int(key: String): Int? =
        this[key]?.jsonPrimitive?.intOrNull
            ?: this[key]?.jsonPrimitive?.contentOrNull?.toIntOrNull()

    private fun JsonObject.objectAt(vararg keys: String): JsonObject? {
        var current: JsonObject = this
        for (key in keys) {
            current = current[key] as? JsonObject ?: return null
        }
        return current
    }

    private fun String.stripHighlight(): String = replace(highlightTags, "").trim()

    private fun String.upgradeToHttps(): String =
        if (startsWith("http://")) "https://" + removePrefix("http://") else this
}
