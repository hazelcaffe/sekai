package io.github.hazelcaffe.sekai.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.hazelcaffe.sekai.R
import io.github.hazelcaffe.sekai.Screen
import io.github.hazelcaffe.sekai.ShellActions

/** Settings → Server in the page opens this: which server the app uses, and the app's own details. */
@Composable
internal fun ServerScreen(server: String?, actions: ShellActions) {
    var confirming by rememberSaveable { mutableStateOf(false) }
    Scaffold(
        topBar = { SekaiTopBar(R.string.server_title, onBack = actions::back) },
        containerColor = MaterialTheme.colorScheme.surface,
    ) { inner ->
        Box(
            modifier = Modifier.fillMaxSize().padding(inner).verticalScroll(rememberScrollState()),
            contentAlignment = Alignment.TopCenter,
        ) {
            Column(
                modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                Group(title = R.string.server_current) {
                    ListItem(
                        colors = transparentItem(),
                        leadingContent = { Icon(painterResource(R.drawable.ic_dns), contentDescription = null) },
                        headlineContent = {
                            Text(
                                server ?: stringResource(R.string.server_not_connected),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    NavRow(R.string.server_change) { actions.open(Screen.Address) }
                }
                Group {
                    NavRow(R.string.about, icon = R.drawable.ic_info) { actions.open(Screen.About) }
                }
                if (server != null) {
                    TextButton(
                        onClick = { confirming = true },
                        modifier = Modifier.align(Alignment.Start),
                    ) {
                        Text(stringResource(R.string.server_forget), color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(stringResource(R.string.forget_title)) },
            text = { Text(stringResource(R.string.forget_text)) },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    actions.forget()
                }) { Text(stringResource(R.string.forget), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { confirming = false }) { Text(stringResource(R.string.cancel)) }
            },
        )
    }
}

@Composable
internal fun transparentItem() = ListItemDefaults.colors(containerColor = Color.Transparent)

/** A rounded group of rows, optionally titled (Material 3 list in a card). */
@Composable
internal fun Group(title: Int? = null, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (title != null) {
            Text(
                stringResource(title),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 16.dp),
            )
        }
        Surface(
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.surfaceContainer,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column { content() }
        }
    }
}

/** A row that opens something: a label and a chevron. */
@Composable
internal fun NavRow(label: Int, icon: Int? = null, onClick: () -> Unit) {
    ListItem(
        modifier = Modifier.clickable(onClick = onClick),
        colors = transparentItem(),
        leadingContent = icon?.let { { Icon(painterResource(it), contentDescription = null) } },
        headlineContent = { Text(stringResource(label)) },
        trailingContent = { Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null) },
    )
}
