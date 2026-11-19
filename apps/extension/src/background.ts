import { browser } from "./browser.ts";

// No remote commands or tokens live in the background. Closing the panel ends its browser lease.
if (browser.sidePanel) {
	void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
} else if (browser.sidebarAction) {
	browser.action.onClicked.addListener(() => {
		void browser.sidebarAction?.toggle();
	});
}
