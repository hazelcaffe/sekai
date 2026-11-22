package io.github.hazelcaffe.sekai.ui

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import io.github.hazelcaffe.sekai.ProblemKind
import io.github.hazelcaffe.sekai.R
import io.github.hazelcaffe.sekai.ServerProblem

@get:StringRes
internal val ServerProblem.title: Int
    get() = when (kind) {
        ProblemKind.Offline -> R.string.offline_title
        ProblemKind.Unreachable -> R.string.unreachable_title
        ProblemKind.Untrusted -> R.string.untrusted_title
        ProblemKind.ServerError -> R.string.server_error_title
        ProblemKind.NotSekai -> R.string.not_sekai_title
    }

@get:DrawableRes
internal val ServerProblem.icon: Int
    get() = when (kind) {
        ProblemKind.Offline -> R.drawable.ic_wifi_off
        ProblemKind.Untrusted -> R.drawable.ic_lock
        ProblemKind.NotSekai -> R.drawable.ic_dns
        else -> R.drawable.ic_cloud_off
    }

/** What to do about it, in a sentence or two. */
@Composable
internal fun ServerProblem.text(): String = when (kind) {
    ProblemKind.Offline -> stringResource(R.string.offline_text)
    ProblemKind.Unreachable -> stringResource(R.string.unreachable_text)
    ProblemKind.Untrusted -> stringResource(R.string.untrusted_text)
    ProblemKind.ServerError -> stringResource(R.string.server_error_text, code ?: 0)
    ProblemKind.NotSekai -> stringResource(R.string.not_sekai_text)
}
