package io.github.hazelcaffe.sekai

import android.content.Context
import java.io.IOException
import java.net.URL
import javax.net.ssl.SSLException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject

/** Why a server couldn't be opened, in the terms the person needs (the screens turn these into sentences). */
internal enum class ProblemKind { Offline, Unreachable, Untrusted, ServerError, NotSekai }

/** [code] is the HTTP status for [ProblemKind.ServerError]. */
internal data class ServerProblem(val kind: ProblemKind, val origin: String, val code: Int? = null)

internal sealed interface ServerCheck {
    /** It's a Sekai server, at [origin] (which may differ after an http → https redirect). */
    data class Ok(val origin: String) : ServerCheck

    data class Problem(val problem: ServerProblem) : ServerCheck
}

/** Checks [origin] answers like a Sekai server: GET /api/auth/status is JSON with a setupRequired field. */
internal suspend fun checkServer(context: Context, origin: String): ServerCheck =
    withContext(Dispatchers.IO) { check(origin) { Connectivity.isOnline(context) } }

private fun check(start: String, isOnline: () -> Boolean): ServerCheck {
    var origin = start
    repeat(MAX_REDIRECTS) {
        val url = "$origin/api/auth/status"
        val res = try {
            httpRequest(url, headers = mapOf("Accept" to "application/json"), timeoutMs = 8_000)
        } catch (_: SSLException) {
            return problem(ProblemKind.Untrusted, origin)
        } catch (_: IOException) {
            return problem(if (isOnline()) ProblemKind.Unreachable else ProblemKind.Offline, origin)
        }
        when {
            res.code in 300..399 -> {
                // Usually http → https; the server's own address is what gets saved.
                val next = res.header("Location")?.let {
                    runCatching { originOf(URL(URL(url), it).toString()) }.getOrNull()
                }
                if (next == null || next == origin) return problem(ProblemKind.NotSekai, origin)
                origin = next
            }
            res.code == 200 && isAuthStatus(res.body) -> return ServerCheck.Ok(origin)
            res.code >= 500 -> return problem(ProblemKind.ServerError, origin, res.code)
            else -> return problem(ProblemKind.NotSekai, origin)
        }
    }
    return problem(ProblemKind.NotSekai, origin)
}

private fun problem(kind: ProblemKind, origin: String, code: Int? = null) =
    ServerCheck.Problem(ServerProblem(kind, origin, code))

private const val MAX_REDIRECTS = 3

private fun isAuthStatus(body: String): Boolean = try {
    JSONObject(body).has("setupRequired")
} catch (_: JSONException) {
    false
}
