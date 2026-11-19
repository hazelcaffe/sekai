package io.github.hazelcaffe.sekai

import java.net.URI
import java.net.URISyntaxException

private val SCHEME = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*)://")

/**
 * What people type ("sekai.example.com", "http://192.168.1.20:7420/c/abc") as an origin
 * ("https://sekai.example.com"): https when there's no scheme, and no path. Null if it isn't an http(s) address.
 */
internal fun normalizeServerUrl(input: String): String? {
    val text = input.trim()
    if (text.isEmpty()) return null
    val scheme = SCHEME.find(text)?.groupValues?.get(1) ?: "https"
    val rest = SCHEME.find(text)?.let { text.substring(it.range.last + 1) } ?: text
    val authority = rest.substringBefore('/').substringBefore('?').substringBefore('#')
    if (authority.isEmpty()) return null
    return originOf("$scheme://$authority")
}

/** The origin of an http(s) URL, written like browsers do: lowercase, without the default port. */
internal fun originOf(url: String): String? {
    val uri = try {
        URI(url)
    } catch (_: URISyntaxException) {
        return null
    }
    val scheme = uri.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") return null
    // "https://sekai.example.com@evil.example" isn't Sekai.
    if (uri.rawUserInfo != null) return null
    val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
    val defaultPort = if (scheme == "http") 80 else 443
    return if (uri.port == -1 || uri.port == defaultPort) "$scheme://$host" else "$scheme://$host:${uri.port}"
}

/** Whether [url] is on [origin] exactly (a prefix check would let https://sekai.example.com.evil.net through). */
internal fun isSameOrigin(url: String?, origin: String?): Boolean =
    url != null && origin != null && originOf(url) == origin

private val SAFE_PATH = Regex("^/(?!/)[\\w\\-./~%?=&#+:@!]*$")

/** A path inside the app ("/c/abc"), or null for anything else (another site, "//evil.example", a script). */
internal fun safePath(path: String?): String? =
    path?.takeIf { it.length <= 1000 && SAFE_PATH.matches(it) && !it.contains("\\") }

private val TOOL_CALL_ID = Regex("^[A-Za-z0-9_.:-]{1,200}$")

internal fun isToolCallId(id: String?): Boolean = id != null && TOOL_CALL_ID.matches(id)
