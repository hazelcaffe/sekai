package io.github.hazelcaffe.sekai

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import android.webkit.ValueCallback
import android.webkit.WebChromeClient.FileChooserParams
import android.widget.Toast
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import java.io.File
import kotlinx.coroutines.launch

/**
 * `<input type="file">` in the page: Android's file picker (with the accept types and multiple), plus the camera
 * when the page takes images. Create it before the activity starts.
 */
internal class FileChooser(private val activity: MainActivity) {
    private var callback: ValueCallback<Array<Uri>>? = null
    private var photo: File? = null
    private var photoUri: Uri? = null
    private val launcher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult(), ::done)

    fun show(callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
        // Only one at a time: an unanswered callback would stop the page's input working.
        this.callback?.onReceiveValue(null)
        this.callback = callback
        val types = mimeTypes(params.acceptTypes)
        val images = types.isEmpty() || types.any { it == "*/*" || it.startsWith("image/") }
        val hasCamera = activity.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        activity.lifecycleScope.launch {
            // The camera app needs Sekai's camera permission (Sekai declares it for calls). The page asking for
            // capture is worth a prompt; otherwise the camera is offered only when it's already allowed.
            val camera = when {
                !images || !hasCamera -> false
                params.isCaptureEnabled -> activity.permissions.request(Manifest.permission.CAMERA)
                else -> activity.permissions.has(Manifest.permission.CAMERA)
            }
            val cameraIntent = if (camera) cameraIntent() else null
            val intent = if (params.isCaptureEnabled && cameraIntent != null) {
                cameraIntent
            } else {
                val pick = pickIntent(types, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                if (cameraIntent == null) {
                    pick
                } else {
                    Intent.createChooser(pick, null).putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(cameraIntent))
                }
            }
            try {
                launcher.launch(intent)
            } catch (_: ActivityNotFoundException) {
                Toast.makeText(activity, R.string.no_file_picker, Toast.LENGTH_LONG).show()
                finish(null)
            }
        }
        return true
    }

    private fun done(result: ActivityResult) {
        val data = result.data
        val picked = buildList {
            val clip = data?.clipData
            if (clip != null) {
                for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let(::add)
            } else {
                data?.data?.let(::add)
            }
        }.filter { it != photoUri }
        val shot = photo?.takeIf { it.length() > 0 }?.let { photoUri }
        finish(
            when {
                result.resultCode != Activity.RESULT_OK -> null
                picked.isNotEmpty() -> picked.toTypedArray()
                shot != null -> arrayOf(shot)
                else -> null
            },
        )
    }

    private fun finish(uris: Array<Uri>?) {
        callback?.onReceiveValue(uris)
        callback = null
        if (uris == null || photoUri !in uris) photo?.delete()
        photo = null
        photoUri = null
    }

    private fun cameraIntent(): Intent? {
        val dir = File(activity.cacheDir, "camera").apply { mkdirs() }
        // Photos from earlier uploads are done with (the page read them).
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        val uri = try {
            FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
        } catch (_: IllegalArgumentException) {
            return null
        }
        photo = file
        photoUri = uri
        return Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .apply { clipData = ClipData.newRawUri("", uri) }
    }

    private fun pickIntent(types: List<String>, multiple: Boolean) = Intent(Intent.ACTION_GET_CONTENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
        .apply {
            type = types.singleOrNull() ?: "*/*"
            if (types.size > 1 && "*/*" !in types) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
        }

    // The accept attribute as MIME types ("image/png,.pdf" → image/png, application/pdf); an extension Android
    // doesn't know allows anything.
    private fun mimeTypes(accept: Array<String>?): List<String> = accept.orEmpty()
        .flatMap { it.split(',') }
        .map { it.trim().lowercase() }
        .filter { it.isNotEmpty() }
        .map { type ->
            if (type.startsWith(".")) {
                MimeTypeMap.getSingleton().getMimeTypeFromExtension(type.removePrefix(".")) ?: "*/*"
            } else {
                type
            }
        }
        .distinct()
}
