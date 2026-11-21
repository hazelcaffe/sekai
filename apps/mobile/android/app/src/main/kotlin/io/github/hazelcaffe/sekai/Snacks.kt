package io.github.hazelcaffe.sekai

import android.content.Context
import android.widget.Toast
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow

/** A short message at the bottom of the screen (a Material 3 snackbar), with one optional button. */
internal data class Snack(val message: String, val action: SnackAction? = null)

internal data class SnackAction(val label: String, val run: () -> Unit)

/** Feedback for things that happen outside the page: saved a file, couldn't open a link. */
internal object Snacks {
    private val queue = Channel<Snack>(Channel.BUFFERED)

    /** What the open screen shows. */
    val flow: Flow<Snack> = queue.receiveAsFlow()

    /** On screen when Sekai is in front; a toast only when no screen can show it. Main thread. */
    fun show(context: Context, snack: Snack) {
        if (AppState.inFront && queue.trySend(snack).isSuccess) return
        Toast.makeText(context.applicationContext, snack.message, Toast.LENGTH_LONG).show()
    }

    fun show(context: Context, message: Int, vararg args: Any) =
        show(context, Snack(context.getString(message, *args)))
}
