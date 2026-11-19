package io.github.hazelcaffe.sekai

import java.io.IOException
import java.net.URL
import javax.net.ssl.SSLException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject

internal sealed interface ServerCheck {
    /** It's a Sekai server, at [origin] (which may differ after an http → https redirect). */
    data class Ok(val origin: String) : ServerCheck

    data class Problem(val message: String) : ServerCheck
}

private const val NOT_SEKAI = "That isn't a Sekai server. Check the address you open Sekai at in your browser."

/** The message when the server can't be reached (the connect screen shows it); [typed] when it's a new address. */
internal fun unreachable(origin: String, typed: Boolean = false) =
    "Couldn't reach $origin. Check ${if (typed) "the address, and that " else ""}you're online " +
        "(and on Tailscale, if that's how you reach Sekai)."

internal fun untrusted(origin: String) =
    "$origin has a certificate this phone doesn't trust. Check the address, or the server's https setup."

/** Checks [origin] answers like a Sekai server: GET /api/auth/status is JSON with a setupRequired field. */
internal suspend fun checkServer(origin: String): ServerCheck = withContext(Dispatchers.IO) { check(origin) }

private fun check(start: String): ServerCheck {
    var origin = start
    repeat(MAX_REDIRECTS) {
        val url = "$origin/api/auth/status"
        val res = try {
            httpRequest(url, headers = mapOf("Accept" to "application/json"), timeoutMs = 8_000)
        } catch (_: SSLException) {
            return ServerCheck.Problem(untrusted(origin))
        } catch (_: IOException) {
            return ServerCheck.Problem(unreachable(origin, typed = true))
        }
        when {
            res.code in 300..399 -> {
                // Usually http → https; the server's own address is what gets saved.
                val next = res.header("Location")?.let {
                    runCatching { originOf(URL(URL(url), it).toString()) }.getOrNull()
                }
                if (next == null || next == origin) return ServerCheck.Problem(NOT_SEKAI)
                origin = next
            }
            res.code == 200 && isAuthStatus(res.body) -> return ServerCheck.Ok(origin)
            res.code >= 500 -> return ServerCheck.Problem(
                "$origin answered with an error (${res.code}). Try again in a moment.",
            )
            else -> return ServerCheck.Problem(NOT_SEKAI)
        }
    }
    return ServerCheck.Problem(NOT_SEKAI)
}

private const val MAX_REDIRECTS = 3

private fun isAuthStatus(body: String): Boolean = try {
    JSONObject(body).has("setupRequired")
} catch (_: JSONException) {
    false
}
