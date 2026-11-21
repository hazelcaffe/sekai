package io.github.hazelcaffe.sekai

import io.github.hazelcaffe.sekai.ui.licenceParagraphs
import org.junit.Assert.assertEquals
import org.junit.Test

class LicenceTest {
    @Test
    fun wrappedLinesFlowIntoParagraphs() {
        val text = "  Heading\n  Version 3\n\nA free,\ncopyleft license.\n\n\n  Second\r\n  one.\n"
        assertEquals(listOf("Heading Version 3", "A free, copyleft license.", "Second one."), licenceParagraphs(text))
    }

    @Test
    fun emptyTextHasNoParagraphs() {
        assertEquals(emptyList<String>(), licenceParagraphs(" \n\n "))
    }
}
