package com.qqmusicdl.mobile.data.api

import com.qqmusicdl.mobile.data.model.AudioQuality
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QqResponseParserTest {
    @Test
    fun `search parses highlighted text singers quality and cover`() {
        val tracks = QqResponseParser.parseSearch(SEARCH_RESPONSE)

        assertEquals(1, tracks.size)
        val track = tracks.single()
        assertEquals("002rROE10ibMXN", track.mid)
        assertEquals("晴天", track.title)
        assertEquals("周杰伦 / 方文山", track.artist)
        assertEquals("叶惠美", track.album)
        assertEquals("001Album", track.albumMid)
        assertEquals("001Media", track.mediaMid)
        assertEquals(269, track.durationSeconds)
        assertEquals(
            "https://y.gtimg.cn/music/photo_new/T002R300x300M000001Album.jpg",
            track.coverUrl,
        )
        assertEquals(
            listOf(AudioQuality.MP3_128, AudioQuality.AAC_96),
            track.availableQualities,
        )
    }

    @Test
    fun `playback absolute URL is upgraded to HTTPS`() {
        val lookup = QqResponseParser.parsePlaybackUrl(
            playbackResponse("http://dl.stream.qqmusic.qq.com/song.m4a"),
            "002rROE10ibMXN",
        )

        assertEquals("https://dl.stream.qqmusic.qq.com/song.m4a", lookup.url)
        assertEquals(0, lookup.resultCode)
    }

    @Test
    fun `playback relative URL uses secure streaming host`() {
        val lookup = QqResponseParser.parsePlaybackUrl(
            playbackResponse("M500song.mp3"),
            "002rROE10ibMXN",
        )

        assertEquals(
            "https://isure.stream.qqmusic.qq.com/M500song.mp3",
            lookup.url,
        )
    }

    @Test
    fun `empty playback URL preserves restriction result`() {
        val lookup = QqResponseParser.parsePlaybackUrl(
            playbackResponse("", result = 104003),
            "002rROE10ibMXN",
        )

        assertNull(lookup.url)
        assertEquals(104003, lookup.resultCode)
    }

    private fun playbackResponse(purl: String, result: Int = 0): String =
        """
        {
          "req_0": {
            "data": {
              "sip": ["http://isure.stream.qqmusic.qq.com/"],
              "midurlinfo": [
                {"songmid": "002rROE10ibMXN", "purl": "$purl", "result": $result}
              ]
            }
          }
        }
        """.trimIndent()

    private companion object {
        val SEARCH_RESPONSE = """
            {
              "req_0": {
                "data": {
                  "body": {
                    "item_song": {
                      "items": [
                        {
                          "mid": "002rROE10ibMXN",
                          "title": "<em>晴天</em>",
                          "interval": "269",
                          "singer": [
                            {"name": "<em>周杰伦</em>"},
                            {"title": "方文山"}
                          ],
                          "album": {
                            "mid": "001Album",
                            "title": "叶惠美"
                          },
                          "file": {
                            "media_mid": "001Media",
                            "size_128mp3": 4096,
                            "size_96aac": 3072,
                            "size_48aac": 0
                          }
                        }
                      ]
                    }
                  }
                }
              }
            }
        """.trimIndent()
    }
}
