package com.qqmusicdl.mobile.data.storage

import org.junit.Assert.assertEquals
import org.junit.Test

class FileNameSanitizerTest {
    @Test
    fun `removes characters forbidden on Android and Windows`() {
        assertEquals(
            "AC DC Back In Black",
            FileNameSanitizer.sanitize("AC/DC: Back*In?Black"),
        )
    }

    @Test
    fun `collapses whitespace and trailing dots`() {
        assertEquals(
            "A Song",
            FileNameSanitizer.sanitize("  A   Song... "),
        )
    }

    @Test
    fun `uses fallback for blank and reserved names`() {
        assertEquals("unknown", FileNameSanitizer.sanitize("   "))
        assertEquals("track", FileNameSanitizer.sanitize("CON", "track"))
    }
}
