package io.github.hazelcaffe.sekai.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.github.hazelcaffe.sekai.BuildConfig
import io.github.hazelcaffe.sekai.ConnectError
import io.github.hazelcaffe.sekai.R
import io.github.hazelcaffe.sekai.ShellActions
import kotlinx.coroutines.launch

/**
 * The address of a Sekai server: the first thing a new install shows ([root]), and "Change server" from the
 * Server screen (with a back arrow). [current] is the saved server, [recent] the others to pick from.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AddressScreen(
    root: Boolean,
    current: String?,
    recent: List<String>,
    actions: ShellActions,
    initialError: ConnectError? = null,
    initialChecking: Boolean = false,
) {
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    var field by rememberSaveable(stateSaver = TextFieldValue.Saver) {
        val text = if (root) "" else current.orEmpty()
        mutableStateOf(TextFieldValue(text, selection = TextRange(0, text.length)))
    }
    var checking by remember { mutableStateOf(initialChecking) }
    var error by remember { mutableStateOf(initialError) }
    val focus = remember { FocusRequester() }
    // Changing the server is a task: the keyboard opens on the address. The first launch shows the page first.
    LaunchedEffect(Unit) { if (!root) focus.requestFocus() }

    fun submit(address: String) {
        if (checking) return
        if (address.isBlank()) {
            error = ConnectError.Empty
            return
        }
        keyboard?.hide()
        checking = true
        error = null
        scope.launch {
            // On success the app switches to the server and this screen goes away.
            error = actions.connect(address)
            checking = false
        }
    }

    val others = recent.filter { it != current }.take(5)
    val form: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            OutlinedTextField(
                value = field,
                onValueChange = {
                    field = it
                    if (error != null) error = null
                },
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
                label = { Text(stringResource(R.string.address_label)) },
                placeholder = { Text(stringResource(R.string.address_placeholder)) },
                singleLine = true,
                enabled = !checking,
                isError = error != null,
                trailingIcon = {
                    if (field.text.isNotEmpty() && !checking) {
                        IconButton(onClick = { field = TextFieldValue("") }) {
                            Icon(
                                painterResource(R.drawable.ic_close),
                                contentDescription = stringResource(R.string.clear_address),
                            )
                        }
                    }
                },
                supportingText = {
                    Text(
                        text = errorText(error) ?: stringResource(R.string.address_hint),
                        modifier = Modifier.semantics { if (error != null) liveRegion = LiveRegionMode.Polite },
                    )
                },
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Go,
                ),
                keyboardActions = KeyboardActions(onGo = { submit(field.text) }),
                shape = MaterialTheme.shapes.medium,
            )
            Button(
                onClick = { submit(field.text) },
                enabled = !checking,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) {
                if (checking) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f),
                    )
                    Spacer(Modifier.size(8.dp))
                    Text(stringResource(R.string.checking))
                } else {
                    Text(stringResource(R.string.connect))
                }
            }
            if (others.isNotEmpty()) {
                RecentServers(others, enabled = !checking, onPick = {
                    field = TextFieldValue(it)
                    submit(it)
                }, onRemove = actions::forgetRecent)
            }
        }
    }

    if (root) {
        Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .verticalScroll(rememberScrollState()),
                contentAlignment = Alignment.TopCenter,
            ) {
                Column(
                    modifier = Modifier.widthIn(max = 480.dp).padding(horizontal = 24.dp, vertical = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Spacer(Modifier.height(24.dp))
                    SekaiLogo(96.dp)
                    Spacer(Modifier.height(24.dp))
                    Text(
                        stringResource(R.string.connect_title),
                        style = MaterialTheme.typography.headlineSmall,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        stringResource(R.string.connect_intro),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(32.dp))
                    form()
                    Spacer(Modifier.height(32.dp))
                    Text(
                        stringResource(R.string.version_footer, BuildConfig.VERSION_NAME),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    } else {
        Scaffold(
            topBar = { SekaiTopBar(R.string.change_server_title, onBack = actions::back) },
            containerColor = MaterialTheme.colorScheme.surface,
        ) { inner ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(inner)
                    .consumeWindowInsets(inner)
                    .imePadding()
                    .verticalScroll(rememberScrollState()),
                contentAlignment = Alignment.TopCenter,
            ) {
                Column(modifier = Modifier.widthIn(max = 480.dp).padding(horizontal = 24.dp, vertical = 16.dp)) {
                    Text(
                        stringResource(R.string.connect_intro),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(24.dp))
                    form()
                }
            }
        }
    }
}

@Composable
private fun errorText(error: ConnectError?): String? = when (error) {
    null -> null
    ConnectError.Empty -> stringResource(R.string.address_empty)
    ConnectError.Invalid -> stringResource(R.string.address_invalid)
    is ConnectError.Server -> "${stringResource(error.problem.title)}. ${error.problem.text()}"
}

@Composable
private fun RecentServers(
    servers: List<String>,
    enabled: Boolean,
    onPick: (String) -> Unit,
    onRemove: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            stringResource(R.string.recent_servers),
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, top = 8.dp),
        )
        Surface(
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.surfaceContainer,
        ) {
            Column {
                servers.forEachIndexed { index, server ->
                    if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    ListItem(
                        modifier = Modifier.clickable(enabled = enabled) { onPick(server) },
                        colors = ListItemDefaults.colors(containerColor = androidx.compose.ui.graphics.Color.Transparent),
                        leadingContent = {
                            Icon(painterResource(R.drawable.ic_history), contentDescription = null)
                        },
                        headlineContent = {
                            Text(server, maxLines = 1, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium)
                        },
                        trailingContent = {
                            IconButton(onClick = { onRemove(server) }, enabled = enabled) {
                                Icon(
                                    painterResource(R.drawable.ic_close),
                                    contentDescription = stringResource(R.string.remove_recent, server),
                                )
                            }
                        },
                    )
                }
            }
        }
    }
}
