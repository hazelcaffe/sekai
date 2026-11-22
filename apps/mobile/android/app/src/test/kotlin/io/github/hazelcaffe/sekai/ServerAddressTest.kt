package io.github.hazelcaffe.sekai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerAddressTest {
    @Test
    fun addsHttpsAndDropsPaths() {
        assertEquals("https://sekai.example.com", normalizeServerUrl(" sekai.example.com "))
        assertEquals("https://sekai.example.com", normalizeServerUrl("https://Sekai.Example.com/c/abc?x=1"))
        assertEquals("http://192.168.1.20:7420", normalizeServerUrl("http://192.168.1.20:7420/"))
        assertEquals("https://localhost:7420", normalizeServerUrl("localhost:7420"))
        assertEquals("http://[fd7a::1]:7420", normalizeServerUrl("http://[fd7a::1]:7420"))
    }

    @Test
    fun dropsDefaultPorts() {
        assertEquals("https://sekai.example.com", normalizeServerUrl("https://sekai.example.com:443"))
        assertEquals("http://sekai.example.com", normalizeServerUrl("http://sekai.example.com:80"))
    }

    @Test
    fun rejectsOtherAddresses() {
        assertNull(normalizeServerUrl(""))
        assertNull(normalizeServerUrl("ftp://sekai.example.com"))
        assertNull(normalizeServerUrl("https://"))
        assertNull(normalizeServerUrl("https://me@evil.example"))
        assertNull(normalizeServerUrl("javascript:alert(1)"))
    }

    @Test
    fun comparesWholeOrigins() {
        assertTrue(isSameOrigin("https://sekai.example.com/c/1", "https://sekai.example.com"))
        assertFalse(isSameOrigin("https://sekai.example.com.evil.net/", "https://sekai.example.com"))
        assertFalse(isSameOrigin("http://sekai.example.com/", "https://sekai.example.com"))
    }

    @Test
    fun keepsPathsInsideTheApp() {
        assertEquals("/c/abc", safePath("/c/abc"))
        assertEquals("/inbox?tab=1", safePath("/inbox?tab=1"))
        assertNull(safePath("//evil.example"))
        assertNull(safePath("https://evil.example"))
        assertNull(safePath("/\\evil.example"))
        assertNull(safePath("javascript:alert(1)"))
    }
}
