package io.github.hazelcaffe.sekai.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.github.hazelcaffe.sekai.Connectivity
import io.github.hazelcaffe.sekai.ProblemKind
import io.github.hazelcaffe.sekai.R
import io.github.hazelcaffe.sekai.Screen
import io.github.hazelcaffe.sekai.ServerProblem
import io.github.hazelcaffe.sekai.ShellActions

/**
 * The page couldn't be opened: what happened and what to do, with Try again and a way out (Change server). When the
 * phone was offline it tries again by itself as soon as there's a network.
 */
@Composable
internal fun ProblemScreen(problem: ServerProblem, retrying: Boolean, actions: ShellActions) {
    val context = LocalContext.current
    val retry by rememberUpdatedState(actions::retry)
    if (problem.kind == ProblemKind.Offline) {
        LaunchedEffect(Unit) {
            var was = Connectivity.isOnline(context)
            Connectivity.online(context).collect { now ->
                if (now && !was) retry()
                was = now
            }
        }
    }
    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxSize()) {
        CenteredColumn {
            StatusIcon(problem.icon)
            Text(
                stringResource(problem.title),
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Origin(problem.origin)
            Text(
                problem.text(),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.size(8.dp))
            Button(
                onClick = actions::retry,
                enabled = !retrying,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) {
                if (retrying) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f),
                    )
                    Spacer(Modifier.size(8.dp))
                    Text(stringResource(R.string.status_trying))
                } else {
                    Text(stringResource(R.string.try_again))
                }
            }
            TextButton(onClick = { actions.open(Screen.Address) }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.server_change))
            }
        }
    }
}

/** The page is taking a while: still trying, and the way out. */
@Composable
internal fun ConnectingScreen(origin: String, actions: ShellActions) {
    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxSize()) {
        CenteredColumn {
            CircularProgressIndicator(modifier = Modifier.size(48.dp))
            Text(
                stringResource(R.string.status_connecting),
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Origin(origin)
            Text(
                stringResource(R.string.status_connecting_slow),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            TextButton(onClick = { actions.open(Screen.Address) }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.server_change))
            }
        }
    }
}

@Composable
private fun Origin(origin: String) {
    SelectionContainer {
        Text(
            origin,
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = FontFamily.Monospace,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

/** The phone's web view is too old for Sekai's bridge: update it from the Play Store. */
@Composable
internal fun WebViewTooOldScreen(actions: ShellActions) {
    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxSize()) {
        CenteredColumn {
            SekaiLogo(88.dp)
            Text(
                stringResource(R.string.webview_title),
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                stringResource(R.string.webview_text),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.size(8.dp))
            Button(
                onClick = actions::updateWebView,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) {
                Text(stringResource(R.string.webview_update))
            }
        }
    }
}
