import { TOOL_CATEGORIES } from "./agent.ts";

/**
 * Sekai's own tools in plain words, without anything a call carried: what the activity log shows for someone else's
 * entries, where what a bot read or wrote isn't the viewer's to see. Every built-in tool has one (a server test
 * checks); a tool that's gone falls back to "Used a tool".
 */
export const TOOL_LABELS: Record<string, string> = {
	memory_save: "Saved to memory",
	memory_update: "Updated memory",
	memory_forget: "Forgot a memory",
	memory_search: "Searched memory",
	note_list: "Checked notes",
	note_read: "Read a note",
	note_write: "Wrote a note",
	note_delete: "Deleted a note",
	routine_list: "Checked routines",
	reminder_create: "Set a reminder",
	routine_create: "Created a routine",
	routine_update: "Updated a routine",
	routine_delete: "Deleted a routine",
	routine_run_now: "Started a test run",
	skill_list: "Checked skills",
	skill_load: "Loaded a skill",
	skill_create: "Created a skill",
	skill_update: "Updated a skill",
	agent_list: "Checked the team",
	agent_message: "Messaged another bot",
	agent_ask: "Asked another bot",
	team_chat_start: "Started a team chat",
	agent_create: "Created a bot",
	agent_update_self: "Updated its own profile",
	web_fetch: "Read a web page",
	web_search: "Searched the web",
	web_map: "Listed a site's pages",
	web_crawl: "Read a website",
	browser_open: "Opened a page",
	browser_snapshot: "Looked at the page",
	browser_find: "Looked for something on the page",
	browser_click: "Clicked on a page",
	browser_type: "Typed on a page",
	browser_fill_form: "Filled in a form",
	browser_select: "Picked an option on a page",
	browser_hover: "Hovered over a page",
	browser_press: "Pressed a key",
	browser_drag: "Dragged on a page",
	browser_back: "Went back",
	browser_tabs: "Used the browser's tabs",
	browser_wait: "Waited for the page",
	browser_screenshot: "Took a screenshot of the page",
	browser_dialog: "Answered a dialog",
	browser_evaluate: "Ran a script on the page",
	browser_login: "Signed in on a page",
	browser_close: "Closed the browser",
	extension_browsers: "Looked for shared browsers",
	extension_browser: "Used a person's browser",
	browser_account: "Used a Discord account",
	discord: "Used Discord",
	browser_social: "Used Instagram or TikTok",
	instagram_dm: "Sent an Instagram message",
	instagram_post: "Posted on Instagram",
	computer_screenshot: "Looked at the screen",
	computer_ui: "Read the screen's controls",
	computer_click: "Clicked on the screen",
	computer_type: "Typed on the computer",
	computer_key: "Pressed keys",
	computer_scroll: "Scrolled",
	computer_drag: "Dragged on the screen",
	computer_open: "Opened an app",
	computer_windows: "Looked at the windows",
	computer_clipboard: "Used the clipboard",
	computer_request: "Asked for a computer",
	computer_status: "Checked its computers",
	computer_resize: "Asked to resize a computer",
	machine_credentials: "Looked up computer passwords",
	run_command: "Ran a command",
	machine_checkpoint: "Used checkpoints",
	read_file: "Read a file",
	write_file: "Wrote a file",
	edit_file: "Edited a file",
	devbox_create: "Created a devbox",
	devbox_delete: "Deleted a devbox",
	machine_ports: "Checked web apps",
	devbox_extend: "Kept a devbox longer",
	hosts_list: "Listed devices",
	host_request_access: "Asked to use a device",
	host_run: "Ran a command on a device",
	host_grant: "Let a bot use a device",
	host_revoke: "Removed access to a device",
	code_index: "Indexed code",
	code_search: "Searched code",
	library_search: "Searched the library",
	library_read: "Read a document",
	attach_image: "Attached an image",
	message_user: "Sent a message",
	voice_message: "Sent a voice message",
	discord_voice: "Used a Discord voice channel",
	call_user: "Made a call",
	x_post: "Posted on X",
	x_delete: "Deleted a post on X",
	x_react: "Reacted on X",
	x_follow: "Followed someone on X",
	x_search: "Searched X",
	x_read: "Read a post on X",
	x_profile: "Looked someone up on X",
	x_timeline: "Read X",
	notify_user: "Sent a notification",
	current_time: "Checked the time",
	conversation_rename: "Renamed the chat",
};

/** A built-in tool's plain name ("Ran a command"), for showing a call without what it carried. */
export function toolLabel(tool: string): string {
	// Own keys only: a name like "constructor" (models and agents can call tools anything) isn't a label.
	return Object.hasOwn(TOOL_LABELS, tool) ? (TOOL_LABELS[tool] as string) : "Used a tool";
}

/** Past tense → [plain verb, -ing form], for the verbs tools' titles start with. */
const VERBS: Record<string, [string, string]> = {
	Accepted: ["accept", "accepting"],
	Added: ["add", "adding"],
	Answered: ["answer", "answering"],
	Asked: ["ask", "asking"],
	Attached: ["attach", "attaching"],
	Called: ["call", "calling"],
	Checked: ["check", "checking"],
	Clicked: ["click", "clicking"],
	Closed: ["close", "closing"],
	Copied: ["copy", "copying"],
	Created: ["create", "creating"],
	Delegated: ["delegate", "delegating"],
	Deleted: ["delete", "deleting"],
	Dismissed: ["dismiss", "dismissing"],
	Dragged: ["drag", "dragging"],
	Edited: ["edit", "editing"],
	Entered: ["enter", "entering"],
	Fetched: ["fetch", "fetching"],
	Filled: ["fill", "filling"],
	Followed: ["follow", "following"],
	Forgot: ["forget", "forgetting"],
	Hovered: ["hover", "hovering"],
	Indexed: ["index", "indexing"],
	Joined: ["join", "joining"],
	Kept: ["keep", "keeping"],
	Left: ["leave", "leaving"],
	Let: ["let", "letting"],
	Listed: ["list", "listing"],
	Loaded: ["load", "loading"],
	Looked: ["look", "looking"],
	Made: ["make", "making"],
	Messaged: ["message", "messaging"],
	Opened: ["open", "opening"],
	Picked: ["pick", "picking"],
	Posted: ["post", "posting"],
	Pressed: ["press", "pressing"],
	Quoted: ["quote", "quoting"],
	Ran: ["run", "running"],
	Reacted: ["react", "reacting"],
	Read: ["read", "reading"],
	Removed: ["remove", "removing"],
	Renamed: ["rename", "renaming"],
	Replied: ["reply", "replying"],
	Saved: ["save", "saving"],
	Scrolled: ["scroll", "scrolling"],
	Searched: ["search", "searching"],
	Sent: ["send", "sending"],
	Set: ["set", "setting"],
	Signed: ["sign", "signing"],
	Spoke: ["speak", "speaking"],
	Started: ["start", "starting"],
	Switched: ["switch", "switching"],
	Took: ["take", "taking"],
	Typed: ["type", "typing"],
	Unfollowed: ["unfollow", "unfollowing"],
	Updated: ["update", "updating"],
	Used: ["use", "using"],
	Waited: ["wait", "waiting"],
	Went: ["go", "going"],
	Wrote: ["write", "writing"],
};

/**
 * A tool call's line as it ended: its title when it worked ("Wrote note “Printer handoff”"), else what didn't
 * happen ("Couldn't write note “Printer handoff”", "Writing note “Printer handoff” was denied"), so a quick look
 * never reads a failure as done.
 */
export function toolOutcome(title: string, status: string): string {
	if (status !== "error" && status !== "denied") return title;
	const space = title.indexOf(" ");
	const first = space === -1 ? title : title.slice(0, space);
	const rest = space === -1 ? "" : title.slice(space);
	const verb = Object.hasOwn(VERBS, first) ? VERBS[first] : undefined;
	if (!verb) return status === "error" ? `Didn't work: ${title}` : `Denied: ${title}`;
	const [plain, doing] = verb;
	return status === "error"
		? `Couldn't ${plain}${rest}`
		: `${doing.charAt(0).toUpperCase()}${doing.slice(1)}${rest} was denied`;
}

/**
 * A kind of tool in plain words, from a call's category: a built-in kind ("Files, commands & devices"), an app by
 * its title ("Trail catalog"; `appTitle` looks it up by the app's name), or a subscription's own tools.
 */
export function toolKindLabel(
	category: string | null | undefined,
	appTitle?: (name: string) => string | null | undefined,
): string | null {
	if (!category) return null;
	if (category === "external") return "its own tools";
	const plain = (s: string) => {
		const words = s.replace(/[_-]+/g, " ").trim();
		return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : s;
	};
	if (category.startsWith("mcp:")) {
		const name = category.slice(4);
		return appTitle?.(name) || plain(name);
	}
	return (TOOL_CATEGORIES as Record<string, string>)[category] ?? plain(category);
}
