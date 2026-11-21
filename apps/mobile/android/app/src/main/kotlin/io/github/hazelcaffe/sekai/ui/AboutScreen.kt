package io.github.hazelcaffe.sekai.ui

import android.os.Build
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import io.github.hazelcaffe.sekai.BuildConfig
import io.github.hazelcaffe.sekai.R
import io.github.hazelcaffe.sekai.Screen
import io.github.hazelcaffe.sekai.ShellActions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The app's version, the server it uses, the licence and the credit for the logo. */
@Composable
internal fun AboutScreen(server: String?, actions: ShellActions) {
    Scaffold(
        topBar = { SekaiTopBar(R.string.about, onBack = actions::back) },
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
                Row(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    SekaiLogo(64.dp)
                    Column {
                        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineSmall)
                        Text(
                            stringResource(R.string.about_version, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Group(title = R.string.about_server) {
                    SelectionContainer {
                        ListItem(
                            colors = transparentItem(),
                            headlineContent = {
                                Text(server ?: stringResource(R.string.server_not_connected), fontFamily = FontFamily.Monospace)
                            },
                        )
                    }
                }
                Group(title = R.string.about_credits) {
                    NavRow(R.string.about_licence) { actions.open(Screen.Licence) }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    ListItem(
                        colors = transparentItem(),
                        headlineContent = { Text(stringResource(R.string.about_credit_title)) },
                        supportingContent = {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(stringResource(R.string.about_credit_what))
                                Text(
                                    stringResource(R.string.about_credit_line),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        },
                    )
                }
                Group {
                    ActionRow(R.string.notification_settings, R.drawable.ic_notifications, actions::openNotificationSettings)
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    ActionRow(R.string.share_details, R.drawable.ic_share, actions::shareDetails)
                }
            }
        }
    }
}

@Composable
private fun ActionRow(label: Int, icon: Int, onClick: () -> Unit) {
    ListItem(
        modifier = Modifier.clickable(onClick = onClick),
        colors = transparentItem(),
        leadingContent = { Icon(painterResource(icon), contentDescription = null) },
        headlineContent = { Text(stringResource(label)) },
    )
}

/** The AGPL text, as shipped with the app. */
@Composable
internal fun LicenceScreen(actions: ShellActions) {
    val context = LocalContext.current
    val fallback = stringResource(R.string.about_licence_text)
    var paragraphs by remember { mutableStateOf<List<String>?>(null) }
    LaunchedEffect(Unit) {
        paragraphs = withContext(Dispatchers.IO) {
            runCatching { context.assets.open("LICENSE").bufferedReader().use { it.readText() } }
                .getOrDefault(fallback)
                .let(::licenceParagraphs)
        }
    }
    Scaffold(
        topBar = { SekaiTopBar(R.string.about_licence, onBack = actions::back) },
        containerColor = MaterialTheme.colorScheme.surface,
    ) { inner ->
        SelectionContainer {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(inner),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 24.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(paragraphs.orEmpty()) { paragraph ->
                    Text(
                        paragraph,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/** The licence file is wrapped at 80 columns: paragraphs are what's between blank lines, each on one flowing line. */
internal fun licenceParagraphs(text: String): List<String> = text.replace("\r", "")
    .split(Regex("\n\\s*\n"))
    .map { paragraph -> paragraph.lines().joinToString(" ") { it.trim() }.trim() }
    .filter { it.isNotEmpty() }

/** A text for support: what's installed, and where it points. */
internal fun appDetails(context: android.content.Context, server: String?): String = context.getString(
    R.string.app_details,
    BuildConfig.VERSION_NAME,
    BuildConfig.VERSION_CODE,
    Build.VERSION.RELEASE,
    server ?: context.getString(R.string.server_not_connected),
)
