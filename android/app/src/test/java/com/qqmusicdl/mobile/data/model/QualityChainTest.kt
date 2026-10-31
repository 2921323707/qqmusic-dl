package com.qqmusicdl.mobile.data.model

import org.junit.Assert.assertEquals
import org.junit.Test

class QualityChainTest {
    @Test
    fun `automatic starts with MP3 and falls back downward`() {
        assertEquals(
            listOf(AudioQuality.MP3_128, AudioQuality.AAC_96, AudioQuality.AAC_48),
            qualityChain(null, fallback = true),
        )
    }

    @Test
    fun `selected quality without fallback is the only attempt`() {
        assertEquals(
            listOf(AudioQuality.AAC_96),
            qualityChain(AudioQuality.AAC_96, fallback = false),
        )
    }

    @Test
    fun `selected quality with fallback keeps order`() {
        assertEquals(
            listOf(AudioQuality.AAC_96, AudioQuality.AAC_48),
            qualityChain(AudioQuality.AAC_96, fallback = true),
        )
    }

    @Test
    fun `resolution message summarizes account restricted qualities`() {
        val result = ResolutionResult(
            source = null,
            failures = listOf(
                ResolutionFailure(
                    AudioQuality.MP3_128,
                    104003,
                    "需要 QQ 音乐账号/VIP 或受版权限制",
                ),
                ResolutionFailure(
                    AudioQuality.AAC_96,
                    104003,
                    "需要 QQ 音乐账号/VIP 或受版权限制",
                ),
                ResolutionFailure(
                    AudioQuality.AAC_48,
                    104003,
                    "需要 QQ 音乐账号/VIP 或受版权限制",
                ),
            ),
        )

        assertEquals(
            "MP3 128 / AAC 96 / AAC 48 均不可用；需要 QQ 音乐账号/VIP 或受版权限制",
            result.userMessage(),
        )
    }

    @Test
    fun `resolution message keeps distinct failure reasons`() {
        val result = ResolutionResult(
            source = null,
            failures = listOf(
                ResolutionFailure(AudioQuality.MP3_128, 104003, "账号受限"),
                ResolutionFailure(AudioQuality.AAC_96, null, "CDN 拒绝"),
            ),
        )

        assertEquals(
            "MP3 128: 账号受限；AAC 96: CDN 拒绝",
            result.userMessage(),
        )
    }
}
