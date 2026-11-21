package io.github.hazelcaffe.sekai

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackStateTest {
    private fun shell(block: ShellState.() -> Unit) = ShellState().apply {
        load = Load.Ready("https://sekai.example.com")
        block()
    }

    @Test
    fun theSystemsOwnBackRunsOnTheRootScreen() {
        assertFalse(shell { pageBack = PageBack(overlay = false, canGoBack = false) }.canHandleBack)
    }

    @Test
    fun backIsHandledWhileThePageHasSomethingToCloseOrAScreenToGoBackTo() {
        assertTrue(shell { pageBack = PageBack(overlay = true) }.canHandleBack)
        assertTrue(shell { pageBack = PageBack(canGoBack = true) }.canHandleBack)
    }

    @Test
    fun aPageThatReportsIsBelievedOverTheWebViewsHistory() {
        assertFalse(shell { historyBack = true; pageBack = PageBack() }.canHandleBack)
    }

    @Test
    fun aPageThatDoesntReportFallsBackToTheWebViewsHistory() {
        assertTrue(shell { historyBack = true }.canHandleBack)
        assertFalse(shell { historyBack = false }.canHandleBack)
    }

    @Test
    fun nativeScreensCloseFirst() {
        assertTrue(shell { stack = listOf(Screen.Server) }.canHandleBack)
        assertTrue(shell { stack = listOf(Screen.Server, Screen.About); pageBack = PageBack() }.canHandleBack)
    }

    @Test
    fun theProblemScreenLeavesBackToTheSystem() {
        val state = shell {
            load = Load.Failed(ServerProblem(ProblemKind.Offline, "https://sekai.example.com"))
            historyBack = true
        }
        assertFalse(state.canHandleBack)
    }

    @Test
    fun whatIsOnTopFollowsTheStackThenTheLoad() {
        val state = ShellState()
        assertTrue(state.front is Front.FirstLaunch)
        state.load = Load.Loading("https://sekai.example.com")
        assertTrue(state.front == null)
        state.load = Load.Loading("https://sekai.example.com", slow = true)
        assertTrue(state.front is Front.Connecting)
        state.push(Screen.Server)
        state.push(Screen.Address)
        assertTrue(state.front == Front.Native(Screen.Address))
        state.pop()
        assertTrue(state.front == Front.Native(Screen.Server))
        state.webViewTooOld = true
        assertTrue(state.front is Front.WebViewTooOld)
    }
}
