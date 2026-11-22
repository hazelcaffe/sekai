package io.github.hazelcaffe.sekai

import java.util.Locale

/**
 * How much of the page's edges the system bars and display cutout cover, in CSS pixels, which the page pads with
 * (`max(env(safe-area-inset-*), var(--sekai-inset-*, 0px))`): the app draws edge to edge and doesn't pad the web
 * view for them. The keyboard is the one thing that makes the web view shorter, and it covers the navigation bar,
 * so while it's up the bottom value is 0.
 */
internal data class CssInsets(val top: Float, val right: Float, val bottom: Float, val left: Float) {
    private fun px(value: Float) = String.format(Locale.US, "%.2fpx", value).replace(".00px", "px")

    private fun entries() = listOf("top" to top, "right" to right, "bottom" to bottom, "left" to left)

    /** Sets the variables on the open page. */
    fun applyScript(): String = "(function(){var r=document.documentElement;if(!r)return;" +
        entries().joinToString("") { (side, value) -> "r.style.setProperty('--sekai-inset-$side','${px(value)}');" } +
        "})()"

    /** The same for pages that haven't started: runs at document start, waiting for <html> if it isn't there yet. */
    fun documentStartScript(): String = "(function(){function set(){var r=document.documentElement;if(!r)return false;" +
        entries().joinToString("") { (side, value) -> "r.style.setProperty('--sekai-inset-$side','${px(value)}');" } +
        "return true}if(!set()){new MutationObserver(function(_,o){if(set())o.disconnect()})" +
        ".observe(document,{childList:true})}})();"

    companion object {
        val NONE = CssInsets(0f, 0f, 0f, 0f)
    }
}
