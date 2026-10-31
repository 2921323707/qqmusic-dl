package com.qqmusicdl.mobile.data.storage

object FileNameSanitizer {
    private val invalidCharacters = Regex("""[\\/:*?"<>|\u0000-\u001F]""")
    private val repeatedWhitespace = Regex("""\s+""")
    private val reservedWindowsNames = Regex(
        """^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$""",
        RegexOption.IGNORE_CASE,
    )

    fun sanitize(value: String, fallback: String = "unknown"): String {
        val cleaned = value
            .replace(invalidCharacters, " ")
            .replace(repeatedWhitespace, " ")
            .trim()
            .trimEnd('.', ' ')
            .take(96)
        return cleaned.takeUnless {
            it.isBlank() || reservedWindowsNames.matches(it)
        } ?: fallback
    }
}
