package io.github.hazelcaffe.sekai

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

internal class HttpResponse(val code: Int, val body: String, private val headers: Map<String?, List<String>>) {
    fun header(name: String): String? =
        headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value?.firstOrNull()
}

/**
 * A small HTTP request for the app's own checks (the web view does everything else). Blocking: call it off the
 * main thread. Redirects aren't followed, so callers see them.
 */
internal fun httpRequest(
    url: String,
    method: String = "GET",
    headers: Map<String, String> = emptyMap(),
    body: ByteArray? = null,
    timeoutMs: Int = 10_000,
): HttpResponse {
    val conn = URL(url).openConnection() as HttpURLConnection
    try {
        conn.requestMethod = method
        conn.instanceFollowRedirects = false
        conn.useCaches = false
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        for ((name, value) in headers) conn.setRequestProperty(name, value)
        if (body != null) {
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(body.size)
            conn.outputStream.use { it.write(body) }
        }
        val code = conn.responseCode
        val stream = if (code >= 400) conn.errorStream else conn.inputStream
        val text = stream?.use { readText(it, MAX_BODY) } ?: ""
        return HttpResponse(code, text, conn.headerFields)
    } finally {
        conn.disconnect()
    }
}

private const val MAX_BODY = 256 * 1024

private fun readText(stream: InputStream, max: Int): String {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (out.size() < max) {
        val n = stream.read(buffer, 0, minOf(buffer.size, max - out.size()))
        if (n < 0) break
        out.write(buffer, 0, n)
    }
    return out.toString(Charsets.UTF_8.name())
}
