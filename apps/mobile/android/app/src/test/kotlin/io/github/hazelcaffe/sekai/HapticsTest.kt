package io.github.hazelcaffe.sekai

import android.os.Build
import android.view.HapticFeedbackConstants
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class HapticsTest {
    @Test
    fun everyKindTheBridgeSendsHasAnEffect() {
        for (kind in Haptics.KINDS) assertNotNull(kind, Haptics.constant(kind, Build.VERSION_CODES.BAKLAVA))
        for (kind in Haptics.KINDS) assertNotNull(kind, Haptics.constant(kind, Build.VERSION_CODES.P))
    }

    @Test
    fun unknownKindsDoNothing() {
        assertNull(Haptics.constant("explosion"))
        assertNull(Haptics.constant(""))
    }

    @Test
    fun newerEffectsAreUsedOnlyWhereTheyExist() {
        assertEquals(HapticFeedbackConstants.CONFIRM, Haptics.constant("success", Build.VERSION_CODES.R))
        assertEquals(HapticFeedbackConstants.LONG_PRESS, Haptics.constant("success", Build.VERSION_CODES.Q))
        assertEquals(HapticFeedbackConstants.REJECT, Haptics.constant("error", Build.VERSION_CODES.R))
        assertEquals(HapticFeedbackConstants.LONG_PRESS, Haptics.constant("error", Build.VERSION_CODES.Q))
        assertEquals(
            HapticFeedbackConstants.SEGMENT_TICK,
            Haptics.constant("selection", Build.VERSION_CODES.UPSIDE_DOWN_CAKE),
        )
        assertEquals(HapticFeedbackConstants.CLOCK_TICK, Haptics.constant("selection", Build.VERSION_CODES.TIRAMISU))
    }
}
