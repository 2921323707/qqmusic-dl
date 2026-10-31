package com.qqmusicdl.mobile.data.api

import android.content.Context
import com.qqmusicdl.mobile.data.model.AudioQuality
import com.qqmusicdl.mobile.data.model.ResolutionResult
import com.qqmusicdl.mobile.data.model.ResolutionFailure
import com.qqmusicdl.mobile.data.model.ResolvedSource
import com.qqmusicdl.mobile.data.model.Track
import com.qqmusicdl.mobile.data.model.qualityChain
import java.io.IOException
import java.security.SecureRandom
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.util.concurrent.TimeUnit

class QqMusicClient(context: Context) {
    private val preferences = context.getSharedPreferences("qqmusic_device", Context.MODE_PRIVATE)
    private val guid = preferences.getString("guid", null) ?: createGuid().also {
        preferences.edit().putString("guid", it).apply()
    }
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun search(keyword: String, limit: Int = 20): List<Track> = withContext(Dispatchers.IO) {
        val query = keyword.trim()
        if (query.isBlank()) return@withContext emptyList()
        val body = buildJsonObject {
            put("comm", webComm())
            put("req_0", buildJsonObject {
                put("module", "music.adaptor.SearchAdaptor")
                put("method", "do_search_v2")
                put("param", buildJsonObject {
                    put("searchid", System.currentTimeMillis().toString())
                    put("search_type", 100)
                    put("page_num", limit.coerceIn(1, 30))
                    put("query", query)
                    put("page_id", 1)
                    put("highlight", true)
                    put("grp", true)
                })
            })
        }
        execute(request("POST", API_URL, body.toString())).use { response ->
            val text = response.requireBody()
            QqResponseParser.parseSearch(text)
        }
    }

    suspend fun resolve(
        track: Track,
        selected: AudioQuality?,
        fallback: Boolean,
    ): ResolutionResult = withContext(Dispatchers.IO) {
        val failures = mutableListOf<ResolutionFailure>()
        for (quality in qualityChain(selected, fallback)) {
            try {
                val lookup = requestPlaybackUrl(track, quality)
                val purl = lookup.url
                if (purl.isNullOrBlank()) {
                    failures += ResolutionFailure(
                        quality = quality,
                        resultCode = lookup.resultCode,
                        reason = playbackFailureReason(lookup.resultCode),
                    )
                    continue
                }
                if (probe(purl)) {
                    return@withContext ResolutionResult(
                        ResolvedSource(track, quality, purl),
                        failures,
                    )
                }
                failures += ResolutionFailure(
                    quality = quality,
                    resultCode = lookup.resultCode,
                    reason = "CDN 拒绝了下载地址",
                )
            } catch (error: Exception) {
                failures += ResolutionFailure(
                    quality = quality,
                    resultCode = null,
                    reason = error.message ?: "请求失败",
                )
            }
        }
        ResolutionResult(null, failures)
    }

    private fun requestPlaybackUrl(track: Track, quality: AudioQuality): PlaybackUrlLookup {
        val filename = buildString {
            append(quality.code)
            append(track.mediaMid)
            append(track.mid)
            append(quality.extension)
        }
        val body = buildJsonObject {
            put("comm", webComm())
            put("req_0", buildJsonObject {
                put("module", "music.vkey.GetVkey")
                put("method", "UrlGetVkey")
                put("param", buildJsonObject {
                    put("guid", guid)
                    put("songmid", buildJsonArray { add(JsonPrimitive(track.mid)) })
                    put("songtype", buildJsonArray { add(JsonPrimitive(0)) })
                    put("filename", buildJsonArray { add(JsonPrimitive(filename)) })
                    put("uin", "0")
                    put("loginflag", 1)
                    put("platform", "23")
                    put("h5queryversion", 1)
                    put("format", "json")
                    put("quality", quality.code)
                    put("needNewCode", 0)
                    put("nohash", 0)
                })
            })
        }
        return execute(request("POST", API_URL, body.toString())).use { response ->
            QqResponseParser.parsePlaybackUrl(response.requireBody(), track.mid)
        }
    }

    private fun probe(url: String): Boolean {
        val request = Request.Builder()
            .url(url)
            .header("Range", "bytes=0-0")
            .header("Referer", "https://y.qq.com/")
            .header("User-Agent", USER_AGENT)
            .build()
        return try {
            http.newCall(request).execute().use { response ->
                response.code == 200 || response.code == 206
            }
        } catch (_: IOException) {
            false
        }
    }

    private fun request(method: String, url: String, body: String): Request =
        Request.Builder()
            .url(url)
            .method(method, body.toRequestBody(jsonMediaType))
            .header("Referer", "https://y.qq.com/")
            .header("User-Agent", USER_AGENT)
            .build()

    private fun execute(request: Request): Response {
        val response = http.newCall(request).execute()
        if (!response.isSuccessful) {
            val code = response.code
            response.close()
            throw IOException("QQ Music HTTP $code")
        }
        return response
    }

    private fun Response.requireBody(): String {
        val bodyText = body?.string().orEmpty()
        if (bodyText.isBlank()) throw IOException("QQ Music returned an empty response")
        return bodyText
    }

    private fun webComm(): JsonObject = buildJsonObject {
        put("ct", 24)
        put("cv", 4747474)
        put("platform", "yqq.json")
        put("chid", "0")
        put("uin", "0")
        put("g_tk", 5381)
        put("g_tk_new_20200303", 5381)
        put("format", "json")
        put("inCharset", "utf-8")
        put("outCharset", "utf-8")
        put("notice", 0)
        put("need_new_code", 1)
    }

    private fun createGuid(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun playbackFailureReason(resultCode: Int?): String = when (resultCode) {
        ACCOUNT_OR_COPYRIGHT_RESTRICTION ->
            "需要 QQ 音乐账号/VIP 或受版权限制"

        else -> "未返回可下载地址"
    }

    private companion object {
        const val API_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg"
        const val ACCOUNT_OR_COPYRIGHT_RESTRICTION = 104003
        const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    }
}
