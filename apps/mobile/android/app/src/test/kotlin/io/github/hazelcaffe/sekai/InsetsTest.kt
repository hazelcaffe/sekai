package io.github.hazelcaffe.sekai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class InsetsTest {
    @Test
    fun setsTheFourVariablesOnTheRoot() {
        val script = CssInsets(top = 50.29f, right = 0f, bottom = 24f, left = 12.5f).applyScript()
        assertTrue(script.contains("--sekai-inset-top','50.29px'"))
        assertTrue(script.contains("--sekai-inset-right','0px'"))
        assertTrue(script.contains("--sekai-inset-bottom','24px'"))
        assertTrue(script.contains("--sekai-inset-left','12.50px'"))
    }

    @Test
    fun numbersDontDependOnThePhonesLanguage() {
        val saved = java.util.Locale.getDefault()
        try {
            java.util.Locale.setDefault(java.util.Locale.GERMANY)
            assertTrue(CssInsets(1.5f, 0f, 0f, 0f).applyScript().contains("'1.50px'"))
        } finally {
            java.util.Locale.setDefault(saved)
        }
    }

    @Test
    fun theDocumentStartScriptWaitsForTheRootElement() {
        val script = CssInsets.NONE.documentStartScript()
        assertTrue(script.contains("MutationObserver"))
        assertTrue(script.contains("documentElement"))
    }

    @Test
    fun noInsetsAreZero() {
        assertEquals(CssInsets(0f, 0f, 0f, 0f), CssInsets.NONE)
    }
}
