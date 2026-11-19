package io.github.hazelcaffe.sekai

import android.content.pm.PackageManager
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Android's runtime permission prompts as a suspend call, one at a time. Create it before the activity starts. */
internal class PermissionAsker(private val activity: ComponentActivity) {
    private var waiting: CompletableDeferred<Unit>? = null
    private val mutex = Mutex()
    private val launcher = activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        waiting?.complete(Unit)
    }

    fun has(permission: String) =
        ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED

    /** Asks for the [permissions] not granted yet; returns which ones are granted now. */
    suspend fun request(permissions: Collection<String>): Map<String, Boolean> = mutex.withLock {
        val missing = permissions.filterNot(::has)
        if (missing.isNotEmpty()) {
            val done = CompletableDeferred<Unit>()
            waiting = done
            launcher.launch(missing.toTypedArray())
            done.await()
            waiting = null
        }
        permissions.associateWith(::has)
    }

    suspend fun request(permission: String): Boolean = request(listOf(permission))[permission] == true
}
