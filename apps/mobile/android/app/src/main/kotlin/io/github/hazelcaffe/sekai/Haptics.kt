package io.github.hazelcaffe.sekai

import android.annotation.SuppressLint
import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View

/**
 * The bridge's `haptic(kind)`: a small tick or buzz for meaningful moments. These are the system's own haptic
 * effects, so they follow the phone's touch feedback setting and need no permission.
 */
internal object Haptics {
    val KINDS = setOf("selection", "light", "medium", "success", "warning", "error")

    /** The [HapticFeedbackConstants] value for [kind] on [sdk], or null for a kind the app doesn't know. */
    @SuppressLint("InlinedApi") // each newer constant is only used when [sdk] has it
    fun constant(kind: String, sdk: Int = Build.VERSION.SDK_INT): Int? = when (kind) {
        "selection" ->
            if (sdk >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK
        "light" -> HapticFeedbackConstants.KEYBOARD_TAP
        "medium" -> HapticFeedbackConstants.VIRTUAL_KEY
        "success" ->
            if (sdk >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.LONG_PRESS
        "warning" -> HapticFeedbackConstants.LONG_PRESS
        "error" ->
            if (sdk >= Build.VERSION_CODES.R) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
        else -> null
    }

    fun perform(view: View, kind: String) {
        view.performHapticFeedback(constant(kind) ?: return)
    }
}
