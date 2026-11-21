package io.github.hazelcaffe.sekai

import android.Manifest
import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Files from the page into the phone's Downloads folder. */
internal object Downloads {
    private const val TAG = "SekaiDownloads"
    private val MIME = Regex("^[\\w.+-]+/[\\w.+-]+$")

    /** The bridge's saveFile: bytes the page made (blob: and data: links) or fetched. */
    fun save(activity: MainActivity, name: String, mime: String, bytes: ByteArray) {
        AppState.scope.launch {
            if (!canWrite(activity)) return@launch
            val type = cleanMime(mime)
            val file = cleanName(name, type)
            val saved = withContext(Dispatchers.IO) {
                runCatching { write(activity, file, type, bytes.inputStream()) }
                    .onFailure { Log.w(TAG, "Couldn't save $file", it) }
                    .getOrNull()
            }
            announce(activity.applicationContext, file, type, saved)
        }
    }

    /**
     * A download the web view started on the server (a file sent as an attachment): DownloadManager fetches it with
     * the web view's cookies and user agent, and shows its own progress and "done" notifications.
     */
    fun enqueue(activity: MainActivity, url: String, userAgent: String, disposition: String?, mime: String?) {
        AppState.scope.launch {
            if (!canWrite(activity)) return@launch
            val type = cleanMime(mime)
            val name = cleanName(fileName(disposition, url), type)
            try {
                val request = DownloadManager.Request(url.toUri())
                    .setMimeType(type)
                    .setTitle(name)
                    .addRequestHeader("User-Agent", userAgent)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
                activity.getSystemService(DownloadManager::class.java).enqueue(request)
                Snacks.show(activity, R.string.downloading, name)
            } catch (e: RuntimeException) {
                Log.w(TAG, "DownloadManager refused $url", e)
                val again = SnackAction(activity.getString(R.string.try_again)) {
                    enqueue(activity, url, userAgent, disposition, mime)
                }
                Snacks.show(activity, Snack(activity.getString(R.string.download_failed), again))
            }
        }
    }

    /**
     * A server file link opened in a new window (target=_blank): fetched here with the web view's cookies, since
     * its name only shows in the response.
     */
    fun fetch(activity: MainActivity, url: String, userAgent: String) {
        val cookies = CookieManager.getInstance().getCookie(url)
        AppState.scope.launch {
            if (!canWrite(activity)) return@launch
            val result = withContext(Dispatchers.IO) {
                runCatching { download(activity, url, userAgent, cookies) }
                    .onFailure { Log.w(TAG, "Couldn't download $url", it) }
                    .getOrNull()
            }
            if (result == null) {
                val again = SnackAction(activity.getString(R.string.try_again)) { fetch(activity, url, userAgent) }
                Snacks.show(activity, Snack(activity.getString(R.string.download_failed), again))
            } else {
                announce(activity.applicationContext, result.first, result.second, result.third)
            }
        }
    }

    private fun download(
        context: Context,
        url: String,
        userAgent: String,
        cookies: String?,
    ): Triple<String, String, Uri> {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.setRequestProperty("User-Agent", userAgent)
            if (cookies != null) conn.setRequestProperty("Cookie", cookies)
            if (conn.responseCode !in 200..299) throw IOException("HTTP ${conn.responseCode}")
            val type = cleanMime(conn.contentType?.substringBefore(';')?.trim())
            val name = cleanName(fileName(conn.getHeaderField("Content-Disposition"), url), type)
            val uri = conn.inputStream.use { write(context, name, type, it) }
            return Triple(name, type, uri)
        } finally {
            conn.disconnect()
        }
    }

    /** Android 9 needs the storage permission to write to Downloads; later versions don't. */
    private suspend fun canWrite(activity: MainActivity): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return true
        if (activity.permissions.request(Manifest.permission.WRITE_EXTERNAL_STORAGE)) return true
        Snacks.show(activity, R.string.storage_needed)
        return false
    }

    /** Writes to Downloads; returns a content:// address other apps can open. */
    private fun write(context: Context, name: String, mime: String, data: InputStream): Uri {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IOException("MediaStore didn't make a file")
            try {
                resolver.openOutputStream(uri)?.use { data.copyTo(it) } ?: throw IOException("Can't write $uri")
                resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            } catch (e: IOException) {
                resolver.delete(uri, null, null)
                throw e
            }
            return uri
        }
        @Suppress("DEPRECATION") // Android 9's way, with WRITE_EXTERNAL_STORAGE
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).apply { mkdirs() }
        val file = unusedFile(dir, name)
        file.outputStream().use { data.copyTo(it) }
        MediaScannerConnection.scanFile(context, arrayOf(file.path), arrayOf(mime), null)
        return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    }

    private fun unusedFile(dir: File, name: String): File {
        val base = name.substringBeforeLast('.', name)
        val ext = name.substringAfterLast('.', "").let { if (it.isEmpty()) "" else ".$it" }
        var file = File(dir, name)
        var n = 1
        while (file.exists()) file = File(dir, "$base (${n++})$ext")
        return file
    }

    /** In the app: a snackbar with Open. Out of it: a notification to tap, or a toast when those are off. */
    private fun announce(context: Context, name: String, mime: String, uri: Uri?) {
        when {
            uri == null -> Snacks.show(context, R.string.save_failed)
            AppState.inFront -> {
                val open = SnackAction(context.getString(R.string.open)) { Notifications.openFile(context, name, uri, mime) }
                Snacks.show(context, Snack(context.getString(R.string.saved_named, name), open))
            }
            Notifications.allowed(context) -> Notifications.saved(context, name, uri, mime)
            else -> Snacks.show(context, R.string.saved_named, name)
        }
    }

    private fun cleanMime(mime: String?): String =
        mime?.lowercase()?.takeIf { MIME.matches(it) } ?: "application/octet-stream"

    /** A name that's safe as a file name, with an extension that matches its type. */
    internal fun cleanName(name: String?, mime: String): String {
        var clean = name.orEmpty()
            .replace(Regex("[\\u0000-\\u001f/\\\\:*?\"<>|]"), "_")
            .trim(' ', '.')
            .take(120)
        if (clean.isEmpty()) clean = "download"
        if (!clean.contains('.')) {
            MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?.let { clean = "$clean.$it" }
        }
        return clean
    }

    /** The name in Content-Disposition (filename*= or filename=), else the address's last part. */
    internal fun fileName(disposition: String?, url: String): String? {
        val header = disposition.orEmpty()
        Regex("filename\\*\\s*=\\s*(?:UTF-8|utf-8)''([^;]+)").find(header)?.let {
            return Uri.decode(it.groupValues[1].trim())
        }
        Regex("filename\\s*=\\s*(?:\"([^\"]*)\"|([^;]+))", RegexOption.IGNORE_CASE).find(header)?.let {
            val value = it.groupValues[1].ifEmpty { it.groupValues[2].trim() }
            if (value.isNotEmpty()) return Uri.decode(value)
        }
        return url.toUri().lastPathSegment
    }
}
