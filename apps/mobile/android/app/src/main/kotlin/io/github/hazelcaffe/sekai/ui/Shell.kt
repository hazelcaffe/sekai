package io.github.hazelcaffe.sekai.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.exclude
import androidx.compose.foundation.layout.imeAnimationTarget
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.WebView
import androidx.compose.runtime.key
import androidx.compose.ui.text.input.ImeAction
import io.github.hazelcaffe.sekai.CssInsets
import io.github.hazelcaffe.sekai.Front
import io.github.hazelcaffe.sekai.JsDialog
import io.github.hazelcaffe.sekai.R
import io.github.hazelcaffe.sekai.Screen
import io.github.hazelcaffe.sekai.ShellActions
import io.github.hazelcaffe.sekai.ShellState
import io.github.hazelcaffe.sekai.Snack
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.coroutineScope

/**
 * The whole app: the server's page edge to edge, and native screens (connecting, the server, offline, about) over
 * it when they're needed. The page gets the bars' and keyboard's sizes as CSS variables, not as padding.
 */
@Composable
internal fun ShellRoot(state: ShellState, actions: ShellActions, snacks: Flow<Snack>, dynamicColor: Boolean = true) {
    val dark = isSystemInDarkTheme()
    SekaiTheme(dark, dynamicColor) {
        val front = state.front
        val surface = MaterialTheme.colorScheme.surface.toArgb()
        LaunchedEffect(front != null, dark, surface) { actions.onBarsFor(front != null, dark, surface) }
        InsetsReporter(actions)
        Box(Modifier.fillMaxSize()) {
            WebLayer(state.web)
            FrontLayer(state, actions)
            SnackbarLayer(snacks)
            state.dialog?.let { dialog -> JsDialogHost(dialog, onDone = { state.dialog = null }) }
        }
    }
}

/**
 * The page: the one web view, kept alive under whatever native screen is shown. It runs edge to edge behind the bars
 * (the page pads for them, see [InsetsReporter]); only the keyboard makes it shorter, once as it opens, so the page
 * lays out as it does in a browser (`interactive-widget=resizes-content`) and keeps what you type in view.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WebLayer(web: WebView?) {
    if (web == null) return
    key(web) {
        AndroidView(
            factory = {
                (web.parent as? ViewGroup)?.removeView(web)
                // Not wrap_content: Chromium sizes such a web view to its content, and 100vh becomes 0.
                web.layoutParams = ViewGroup.LayoutParams(MATCH_PARENT, MATCH_PARENT)
                web
            },
            modifier = Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.imeAnimationTarget),
        )
    }
}

private fun Front.key(): String = when (this) {
    Front.WebViewTooOld -> "webview"
    Front.FirstLaunch -> "first"
    is Front.Native -> screen.name
    is Front.Problem -> "problem"
    is Front.Connecting -> "connecting"
}

/** How deep a screen is, so going deeper slides one way and back the other. */
private fun ShellState.depth(front: Front?): Int = when (front) {
    null -> 0
    is Front.Native -> 1 + stack.indexOf(front.screen).coerceAtLeast(0)
    else -> 1
}

@Composable
private fun FrontLayer(state: ShellState, actions: ShellActions) {
    AnimatedContent(
        targetState = state.front,
        modifier = Modifier.fillMaxSize(),
        contentKey = { it?.key() },
        transitionSpec = {
            val forward = state.depth(targetState) >= state.depth(initialState)
            val sign = if (forward) 1 else -1
            val move = tween<androidx.compose.ui.unit.IntOffset>(300, easing = FastOutSlowInEasing)
            ContentTransform(
                targetContentEnter = slideInHorizontally(move) { sign * it / 6 } + fadeIn(tween(210, 90)),
                initialContentExit = slideOutHorizontally(move) { -sign * it / 6 } + fadeOut(tween(90)),
            )
        },
        label = "front",
    ) { front ->
        if (front != null) {
            Box(
                Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        // The back gesture shrinks the screen on its way out (Material 3 predictive back).
                        val progress = if (front is Front.Native) state.backProgress else 0f
                        scaleX = 1f - 0.1f * progress
                        scaleY = 1f - 0.1f * progress
                        shape = RoundedCornerShape((28 * progress).dp)
                        clip = progress > 0f
                    },
            ) {
                FrontContent(front, state, actions)
            }
        }
    }
}

@Composable
private fun FrontContent(front: Front, state: ShellState, actions: ShellActions) {
    when (front) {
        Front.WebViewTooOld -> WebViewTooOldScreen(actions)
        Front.FirstLaunch -> AddressScreen(root = true, current = null, recent = state.recent, actions = actions)
        is Front.Problem -> ProblemScreen(front.problem, front.retrying, actions)
        is Front.Connecting -> ConnectingScreen(front.origin, actions)
        is Front.Native -> when (front.screen) {
            Screen.Server -> ServerScreen(state.server, actions)
            Screen.Address -> AddressScreen(
                root = false,
                current = state.server,
                recent = state.recent,
                actions = actions,
            )
            Screen.About -> AboutScreen(state.server, actions)
            Screen.Licence -> LicenceScreen(actions)
        }
    }
}

@Composable
private fun SnackbarLayer(snacks: Flow<Snack>) {
    val host = remember { SnackbarHostState() }
    LaunchedEffect(snacks) {
        coroutineScope {
            snacks.collect { snack ->
                launch {
                    val result = host.showSnackbar(
                        message = snack.message,
                        actionLabel = snack.action?.label,
                        duration = if (snack.action != null) SnackbarDuration.Long else SnackbarDuration.Short,
                    )
                    if (result == SnackbarResult.ActionPerformed) snack.action?.run?.invoke()
                }
            }
        }
    }
    Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing), contentAlignment = Alignment.BottomCenter) {
        SnackbarHost(host)
    }
}

/** A page's alert, confirm or prompt as a Material 3 dialog. */
@Composable
private fun JsDialogHost(dialog: JsDialog, onDone: () -> Unit) {
    when (dialog) {
        is JsDialog.Alert -> AlertDialog(
            onDismissRequest = {
                dialog.result.confirm()
                onDone()
            },
            text = { Text(dialog.message) },
            confirmButton = {
                TextButton(onClick = {
                    dialog.result.confirm()
                    onDone()
                }) { Text(stringResource(R.string.ok)) }
            },
        )
        is JsDialog.Confirm -> AlertDialog(
            onDismissRequest = {
                dialog.result.cancel()
                onDone()
            },
            text = { Text(dialog.message) },
            confirmButton = {
                TextButton(onClick = {
                    dialog.result.confirm()
                    onDone()
                }) { Text(stringResource(R.string.ok)) }
            },
            dismissButton = {
                TextButton(onClick = {
                    dialog.result.cancel()
                    onDone()
                }) { Text(stringResource(R.string.cancel)) }
            },
        )
        is JsDialog.Prompt -> {
            var text by remember(dialog) { mutableStateOf(dialog.initial) }
            AlertDialog(
                onDismissRequest = {
                    dialog.result.cancel()
                    onDone()
                },
                text = {
                    Column {
                        if (dialog.message.isNotEmpty()) {
                            Text(dialog.message)
                            Spacer(Modifier.height(12.dp))
                        }
                        OutlinedTextField(
                            value = text,
                            onValueChange = { text = it },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        dialog.result.confirm(text)
                        onDone()
                    }) { Text(stringResource(R.string.ok)) }
                },
                dismissButton = {
                    TextButton(onClick = {
                        dialog.result.cancel()
                        onDone()
                    }) { Text(stringResource(R.string.cancel)) }
                },
            )
        }
    }
}

/**
 * Tells the page how much of its edges the system bars and display cutout cover, in CSS pixels, whenever they or the
 * keyboard change. The keyboard is already out of the web view's way (see [WebLayer]), so it takes the navigation
 * bar's share with it: the bottom value is the bar's height, and 0 while the keyboard is up.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InsetsReporter(actions: ShellActions) {
    val density = LocalDensity.current
    val direction = LocalLayoutDirection.current
    val insets = WindowInsets.systemBars.union(WindowInsets.displayCutout).exclude(WindowInsets.imeAnimationTarget)
    LaunchedEffect(insets, density, direction) {
        snapshotFlow {
            val scale = density.density
            CssInsets(
                top = insets.getTop(density) / scale,
                right = insets.getRight(density, direction) / scale,
                bottom = insets.getBottom(density) / scale,
                left = insets.getLeft(density, direction) / scale,
            )
        }.distinctUntilChanged().collect(actions::onInsets)
    }
}
