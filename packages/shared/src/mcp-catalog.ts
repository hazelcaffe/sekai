/**
 * The app store: popular MCP servers and how to connect each (checked November 2026). Remote apps sign in with
 * OAuth (most register Sekai automatically; some need your own OAuth client), take a key, or need nothing.
 * Local ones run a command on the Sekai server.
 */

export const MCP_CATEGORIES = {
	productivity: "Productivity",
	communication: "Communication",
	developer: "Developer",
	cloud: "Cloud",
	data: "Data",
	search: "Search & web",
	design: "Design",
	finance: "Payments",
	browser: "Browser",
	other: "More",
} as const;
export type McpCategory = keyof typeof MCP_CATEGORIES;

export type McpSetup =
	/** Sign in on the app's own page. */
	| {
			kind: "oauth";
			url: string;
			/** The app doesn't register clients automatically: you create an OAuth client and paste its id/secret. */
			byoClient?: { help: string; url: string; secretRequired?: boolean };
			/** Ask for these scopes (Google lists every scope it has otherwise). */
			scope?: string;
			/** Added to the sign-in page's address (Google needs these for a lasting sign-in). */
			authParams?: Record<string, string>;
			/** It only accepts sign-ins coming back to localhost. */
			loopbackOnly?: boolean;
	  }
	/** An API key or token, sent as a header (or in the URL). */
	| {
			kind: "key";
			url: string;
			header?: string;
			/** Put in front of the key, e.g. "Bearer ". */
			prefix?: string;
			/** Sent as this query parameter instead of a header. */
			query?: string;
			label: string;
			keyUrl?: string;
			help?: string;
	  }
	/** Free to use, nothing to set up. */
	| { kind: "none"; url: string }
	/** Runs on the Sekai server (npx / uvx / docker). */
	| {
			kind: "command";
			command: string;
			args: string[];
			env?: { name: string; label: string; url?: string; optional?: boolean }[];
			/** Placeholders in args ("<dir>") you fill in. */
			params?: { token: string; label: string; placeholder: string }[];
			help?: string;
	  }
	/** A server on your own network (Home Assistant): you give its address. */
	| {
			kind: "self-hosted";
			urlTemplate: string;
			hostLabel: string;
			hostPlaceholder: string;
			header: string;
			prefix: string;
			label: string;
			help: string;
	  };

export interface McpCatalogEntry {
	id: string;
	name: string;
	publisher: string;
	description: string;
	/** A few things it can do, for the details page. */
	does: string[];
	category: McpCategory;
	docs: string;
	/** For its icon (the site's own favicon, fetched by the server). */
	domain: string;
	/** Ways to connect, best first. */
	setups: McpSetup[];
	/** Shown on the front of the store. */
	featured?: boolean;
	/** "Preview" etc. */
	badge?: string;
	/** Not made by the service itself. */
	community?: boolean;
}

const GOOGLE_CLIENT = {
	help: "In the Google Cloud console: Google Auth Platform → Clients → Create client → Web application. Add the redirect address below, enable the app's API, and add yourself as a test user on the consent screen.",
	url: "https://console.cloud.google.com/auth/clients",
	secretRequired: true,
};
const GOOGLE_PARAMS = { access_type: "offline", prompt: "consent" };
const NPX = "npx";

export const MCP_CATALOG: McpCatalogEntry[] = [
	// ---------------------------------------------------------------- productivity
	{
		id: "notion",
		name: "Notion",
		publisher: "Notion",
		description: "Search, read and edit your Notion pages and databases.",
		does: ["Find pages and databases", "Read and write pages", "Add database entries", "Comment"],
		category: "productivity",
		docs: "https://developers.notion.com/docs/get-started-with-mcp",
		domain: "notion.so",
		setups: [{ kind: "oauth", url: "https://mcp.notion.com/mcp" }],
		featured: true,
	},
	{
		id: "linear",
		name: "Linear",
		publisher: "Linear",
		description: "Create and update issues, projects and docs in Linear.",
		does: ["Find and create issues", "Update status, assignee and labels", "Read projects and cycles"],
		category: "productivity",
		docs: "https://linear.app/docs/mcp",
		domain: "linear.app",
		setups: [
			{ kind: "oauth", url: "https://mcp.linear.app/mcp" },
			{
				kind: "key",
				url: "https://mcp.linear.app/mcp",
				header: "Authorization",
				prefix: "Bearer ",
				label: "Linear API key",
				keyUrl: "https://linear.app/settings/account/security",
			},
		],
		featured: true,
	},
	{
		id: "atlassian",
		name: "Jira & Confluence",
		publisher: "Atlassian",
		description: "Work with Jira issues, Confluence pages, Bitbucket and Loom.",
		does: ["Search and create Jira issues", "Read and write Confluence pages", "Summarize projects"],
		category: "productivity",
		docs: "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/",
		domain: "atlassian.com",
		setups: [{ kind: "oauth", url: "https://mcp.atlassian.com/v2/mcp" }],
	},
	{
		id: "gmail",
		name: "Gmail",
		publisher: "Google",
		description: "Search your mail, read threads, draft replies and label messages.",
		does: ["Search and read threads", "Write drafts", "Label messages"],
		category: "productivity",
		docs: "https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server",
		domain: "mail.google.com",
		setups: [
			{
				kind: "oauth",
				url: "https://gmailmcp.googleapis.com/mcp/v1",
				byoClient: GOOGLE_CLIENT,
				scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.labels",
				authParams: GOOGLE_PARAMS,
			},
		],
		featured: true,
		badge: "Preview",
	},
	{
		id: "google-calendar",
		name: "Google Calendar",
		publisher: "Google",
		description: "See and manage your calendar events.",
		does: ["See what's coming up", "Create and move events", "Find free time"],
		category: "productivity",
		docs: "https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server",
		domain: "calendar.google.com",
		setups: [
			{
				kind: "oauth",
				url: "https://calendarmcp.googleapis.com/mcp/v1",
				byoClient: GOOGLE_CLIENT,
				scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
				authParams: GOOGLE_PARAMS,
			},
		],
		featured: true,
		badge: "Preview",
	},
	{
		id: "google-drive",
		name: "Google Drive",
		publisher: "Google",
		description: "Find and read files in your Google Drive.",
		does: ["Search files", "Read documents, sheets and PDFs"],
		category: "productivity",
		docs: "https://developers.google.com/workspace/drive/api/guides/configure-mcp-server",
		domain: "drive.google.com",
		setups: [
			{
				kind: "oauth",
				url: "https://drivemcp.googleapis.com/mcp/v1",
				byoClient: GOOGLE_CLIENT,
				scope: "https://www.googleapis.com/auth/drive.readonly",
				authParams: GOOGLE_PARAMS,
			},
		],
		badge: "Preview",
	},
	{
		id: "google-docs",
		name: "Google Docs",
		publisher: "Google",
		description: "Read and edit your Google Docs.",
		does: ["Read documents", "Write and edit text"],
		category: "productivity",
		docs: "https://developers.google.com/workspace/docs/api/guides/configure-mcp-server",
		domain: "docs.google.com",
		setups: [
			{
				kind: "oauth",
				url: "https://docsmcp.googleapis.com/mcp/v1",
				byoClient: GOOGLE_CLIENT,
				scope: "https://www.googleapis.com/auth/documents",
				authParams: GOOGLE_PARAMS,
			},
		],
		badge: "Preview",
	},
	{
		id: "google-workspace",
		name: "Google Workspace (all in one)",
		publisher: "taylorwilsdon",
		description: "Gmail, Calendar, Drive, Docs, Sheets and more in one server.",
		does: ["Send and search mail", "Manage events", "Read and edit Drive files"],
		category: "productivity",
		docs: "https://github.com/taylorwilsdon/google_workspace_mcp",
		domain: "workspace.google.com",
		setups: [
			{
				kind: "command",
				command: "uvx",
				args: ["workspace-mcp", "--tool-tier", "core"],
				env: [
					{
						name: "GOOGLE_OAUTH_CLIENT_ID",
						label: "Google OAuth client ID",
						url: "https://console.cloud.google.com/auth/clients",
					},
					{ name: "GOOGLE_OAUTH_CLIENT_SECRET", label: "Google OAuth client secret" },
				],
				help: "Needs uv on the Sekai server and your own Google OAuth client with the Workspace APIs enabled.",
			},
		],
		community: true,
	},
	{
		id: "asana",
		name: "Asana",
		publisher: "Asana",
		description: "Manage tasks, projects and goals in Asana.",
		does: ["Create and update tasks", "Read projects and goals"],
		category: "productivity",
		docs: "https://developers.asana.com/docs/integrating-with-asanas-mcp-server",
		domain: "asana.com",
		setups: [
			{
				kind: "oauth",
				url: "https://mcp.asana.com/v2/mcp",
				byoClient: {
					help: "In Asana's developer console: Create new app → type “MCP app”, add the redirect address below, then copy its client ID and secret.",
					url: "https://app.asana.com/0/my-apps",
					secretRequired: true,
				},
			},
		],
	},
	{
		id: "monday",
		name: "monday.com",
		publisher: "monday.com",
		description: "Read and update monday.com boards and items.",
		does: ["Read boards", "Create and update items"],
		category: "productivity",
		docs: "https://developer.monday.com/apps/docs/mondaycom-mcp-integration",
		domain: "monday.com",
		setups: [{ kind: "oauth", url: "https://mcp.monday.com/mcp" }],
	},
	{
		id: "clickup",
		name: "ClickUp",
		publisher: "ClickUp",
		description: "Manage ClickUp tasks, docs and lists.",
		does: ["Create and update tasks", "Read docs and lists"],
		category: "productivity",
		docs: "https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server",
		domain: "clickup.com",
		setups: [{ kind: "oauth", url: "https://mcp.clickup.com/mcp" }],
	},
	{
		id: "todoist",
		name: "Todoist",
		publisher: "Doist",
		description: "Add and manage your Todoist tasks.",
		does: ["Add tasks", "See what's due", "Complete tasks"],
		category: "productivity",
		docs: "https://developer.todoist.com/",
		domain: "todoist.com",
		setups: [{ kind: "oauth", url: "https://ai.todoist.net/mcp" }],
	},
	{
		id: "airtable",
		name: "Airtable",
		publisher: "Airtable",
		description: "Query and edit your Airtable bases.",
		does: ["Search records", "Create and update records"],
		category: "productivity",
		docs: "https://support.airtable.com/docs/using-the-airtable-mcp-server",
		domain: "airtable.com",
		setups: [
			{ kind: "oauth", url: "https://mcp.airtable.com/mcp" },
			{
				kind: "key",
				url: "https://mcp.airtable.com/mcp",
				header: "Authorization",
				prefix: "Bearer ",
				label: "Personal access token",
				keyUrl: "https://airtable.com/create/tokens",
			},
		],
	},
	{
		id: "zapier",
		name: "Zapier",
		publisher: "Zapier",
		description: "Run actions across 8,000+ apps through Zapier.",
		does: ["Send to almost any app", "Run your Zaps"],
		category: "productivity",
		docs: "https://docs.zapier.com/mcp/get-started/authentication",
		domain: "zapier.com",
		setups: [{ kind: "oauth", url: "https://mcp.zapier.com/api/v1/connect" }],
	},
	// ---------------------------------------------------------------- communication
	{
		id: "slack",
		name: "Slack",
		publisher: "Slack",
		description: "Search Slack, read channels and threads, and send messages.",
		does: ["Search messages", "Read channels and threads", "Post messages"],
		category: "communication",
		docs: "https://docs.slack.dev/ai/slack-mcp-server",
		domain: "slack.com",
		setups: [
			{
				kind: "oauth",
				url: "https://mcp.slack.com/mcp",
				byoClient: {
					help: "Create a Slack app in your workspace (api.slack.com/apps), add the redirect address below under OAuth & Permissions, add user scopes, then copy its client ID and secret.",
					url: "https://api.slack.com/apps",
					secretRequired: true,
				},
			},
		],
	},
	{
		id: "hubspot",
		name: "HubSpot",
		publisher: "HubSpot",
		description: "Look up and update HubSpot CRM records.",
		does: ["Find contacts and deals", "Update records"],
		category: "communication",
		docs: "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server",
		domain: "hubspot.com",
		setups: [
			{
				kind: "oauth",
				url: "https://mcp.hubspot.com",
				byoClient: {
					help: "In your HubSpot developer account: Development → MCP Connectors → Create, add the redirect address below, then copy the client ID and secret.",
					url: "https://developers.hubspot.com/",
					secretRequired: true,
				},
			},
		],
	},
	{
		id: "intercom",
		name: "Intercom",
		publisher: "Intercom",
		description: "Look up Intercom conversations, contacts and tickets.",
		does: ["Search conversations", "Read contacts and tickets"],
		category: "communication",
		docs: "https://developers.intercom.com/docs/guides/mcp",
		domain: "intercom.com",
		setups: [{ kind: "oauth", url: "https://mcp.intercom.com/mcp", loopbackOnly: true }],
	},
	// ---------------------------------------------------------------- developer
	{
		id: "github",
		name: "GitHub",
		publisher: "GitHub",
		description: "Work with repositories, issues, pull requests and Actions.",
		does: ["Read code and files", "Open and review pull requests", "Manage issues", "Check Actions runs"],
		category: "developer",
		docs: "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md",
		domain: "github.com",
		setups: [
			{
				kind: "key",
				url: "https://api.githubcopilot.com/mcp/",
				header: "Authorization",
				prefix: "Bearer ",
				label: "Personal access token",
				keyUrl: "https://github.com/settings/personal-access-tokens/new",
				help: "A fine-grained token with access to the repositories you want bots to use.",
			},
			{
				kind: "oauth",
				url: "https://api.githubcopilot.com/mcp/",
				byoClient: {
					help: "Create an OAuth app (GitHub → Settings → Developer settings → OAuth Apps) with the redirect address below as its callback URL, then copy its client ID and a client secret.",
					url: "https://github.com/settings/developers",
					secretRequired: true,
				},
			},
		],
		featured: true,
	},
	{
		id: "gitlab",
		name: "GitLab",
		publisher: "GitLab",
		description: "Work with GitLab projects, issues and merge requests.",
		does: ["Read projects and code", "Manage issues and merge requests"],
		category: "developer",
		docs: "https://docs.gitlab.com/user/model_context_protocol/mcp_server/",
		domain: "gitlab.com",
		setups: [{ kind: "oauth", url: "https://gitlab.com/api/v4/mcp" }],
	},
	{
		id: "sentry",
		name: "Sentry",
		publisher: "Sentry",
		description: "Investigate errors, issues and traces in Sentry.",
		does: ["Find and explain errors", "Read traces", "Search issues"],
		category: "developer",
		docs: "https://docs.sentry.io/product/sentry-mcp/",
		domain: "sentry.io",
		setups: [{ kind: "oauth", url: "https://mcp.sentry.dev/mcp" }],
	},
	{
		id: "vercel",
		name: "Vercel",
		publisher: "Vercel",
		description: "Manage Vercel projects and deployments, and search Vercel's docs.",
		does: ["Check deployments and logs", "Manage projects", "Search the docs"],
		category: "developer",
		docs: "https://vercel.com/docs/agent-resources/vercel-mcp",
		domain: "vercel.com",
		setups: [{ kind: "oauth", url: "https://mcp.vercel.com", loopbackOnly: true }],
	},
	{
		id: "netlify",
		name: "Netlify",
		publisher: "Netlify",
		description: "Create, deploy and manage Netlify sites.",
		does: ["Deploy sites", "Manage projects and settings"],
		category: "developer",
		docs: "https://docs.netlify.com/build/build-with-ai/netlify-mcp-server/",
		domain: "netlify.com",
		setups: [{ kind: "oauth", url: "https://mcp.netlify.com/mcp" }],
	},
	{
		id: "context7",
		name: "Context7",
		publisher: "Upstash",
		description: "Up-to-date docs for any library or framework, for coding.",
		does: ["Look up current library docs", "Get code examples"],
		category: "developer",
		docs: "https://github.com/upstash/context7",
		domain: "context7.com",
		setups: [
			{ kind: "none", url: "https://mcp.context7.com/mcp" },
			{
				kind: "key",
				url: "https://mcp.context7.com/mcp",
				header: "Authorization",
				prefix: "Bearer ",
				label: "Context7 API key",
				keyUrl: "https://context7.com/dashboard",
				help: "Optional: higher limits.",
			},
		],
		featured: true,
	},
	{
		id: "deepwiki",
		name: "DeepWiki",
		publisher: "Cognition",
		description: "Ask questions about any public GitHub repository.",
		does: ["Explain how a repo works", "Find where things are in a codebase"],
		category: "developer",
		docs: "https://docs.devin.ai/work-with-devin/deepwiki-mcp",
		domain: "deepwiki.com",
		setups: [{ kind: "none", url: "https://mcp.deepwiki.com/mcp" }],
	},
	{
		id: "huggingface",
		name: "Hugging Face",
		publisher: "Hugging Face",
		description: "Search models, datasets, papers and Spaces on the Hub.",
		does: ["Find models and datasets", "Search papers", "Look up Spaces"],
		category: "developer",
		docs: "https://huggingface.co/settings/mcp",
		domain: "huggingface.co",
		setups: [
			{ kind: "none", url: "https://huggingface.co/mcp" },
			{ kind: "oauth", url: "https://huggingface.co/mcp?login" },
		],
	},
	{
		id: "ms-learn",
		name: "Microsoft Learn",
		publisher: "Microsoft",
		description: "Search official Microsoft and Azure documentation.",
		does: ["Search Microsoft docs", "Fetch articles and code samples"],
		category: "developer",
		docs: "https://github.com/MicrosoftDocs/mcp",
		domain: "learn.microsoft.com",
		setups: [{ kind: "none", url: "https://learn.microsoft.com/api/mcp" }],
	},
	{
		id: "aws-knowledge",
		name: "AWS Knowledge",
		publisher: "AWS",
		description: "Search AWS documentation and guidance.",
		does: ["Search AWS docs", "Find best practices"],
		category: "developer",
		docs: "https://github.com/awslabs/mcp/tree/main/src/aws-knowledge-mcp-server",
		domain: "aws.amazon.com",
		setups: [{ kind: "none", url: "https://knowledge-mcp.global.api.aws" }],
	},
	{
		id: "google-developer-knowledge",
		name: "Google Developer Docs",
		publisher: "Google",
		description: "Search Google's developer documentation.",
		does: ["Search Google developer docs", "Fetch pages"],
		category: "developer",
		docs: "https://developers.google.com/knowledge/mcp",
		domain: "developers.google.com",
		setups: [
			{
				kind: "key",
				url: "https://developerknowledge.googleapis.com/mcp",
				header: "X-Goog-Api-Key",
				label: "Google API key",
				keyUrl: "https://console.cloud.google.com/apis/credentials",
			},
		],
	},
	{
		id: "firebase",
		name: "Firebase",
		publisher: "Google",
		description: "Manage Firebase projects, Firestore, Auth and more.",
		does: ["Read and write Firestore", "Manage users", "Deploy"],
		category: "developer",
		docs: "https://firebase.google.com/docs/ai-assistance/mcp-server",
		domain: "firebase.google.com",
		setups: [
			{
				kind: "command",
				command: NPX,
				args: ["-y", "firebase-tools@latest", "mcp"],
				help: "Run `firebase login` on the Sekai server first.",
			},
		],
	},
	// ---------------------------------------------------------------- cloud
	{
		id: "cloudflare",
		name: "Cloudflare",
		publisher: "Cloudflare",
		description: "Manage Workers, DNS, R2, D1 and the rest of your Cloudflare account.",
		does: [
			"Deploy and inspect Workers",
			"Manage DNS and zones",
			"Work with R2, D1 and KV",
			"Search Cloudflare's docs",
		],
		category: "cloud",
		docs: "https://github.com/cloudflare/mcp",
		domain: "cloudflare.com",
		setups: [
			{ kind: "oauth", url: "https://mcp.cloudflare.com/mcp" },
			{
				kind: "key",
				url: "https://mcp.cloudflare.com/mcp",
				header: "Authorization",
				prefix: "Bearer ",
				label: "Cloudflare API token",
				keyUrl: "https://dash.cloudflare.com/profile/api-tokens",
			},
		],
		featured: true,
	},
	{
		id: "cloudflare-docs",
		name: "Cloudflare Docs",
		publisher: "Cloudflare",
		description: "Search Cloudflare's developer documentation.",
		does: ["Search the docs", "Answer how-to questions"],
		category: "cloud",
		docs: "https://github.com/cloudflare/mcp-server-cloudflare",
		domain: "developers.cloudflare.com",
		setups: [{ kind: "none", url: "https://docs.mcp.cloudflare.com/mcp" }],
	},
	{
		id: "cloudflare-browser",
		name: "Cloudflare Browser",
		publisher: "Cloudflare",
		description: "Fetch web pages as Markdown and take screenshots, on Cloudflare.",
		does: ["Read pages as Markdown", "Take screenshots"],
		category: "browser",
		docs: "https://github.com/cloudflare/mcp-server-cloudflare",
		domain: "cloudflare.com",
		setups: [{ kind: "oauth", url: "https://browser.mcp.cloudflare.com/mcp" }],
	},
	{
		id: "google-cloud-run",
		name: "Google Cloud Run",
		publisher: "Google Cloud",
		description: "Deploy and manage Cloud Run services.",
		does: ["Deploy services", "Read logs and status"],
		category: "cloud",
		docs: "https://docs.cloud.google.com/run/docs/use-cloud-run-mcp",
		domain: "cloud.google.com",
		setups: [
			{
				kind: "oauth",
				url: "https://run.googleapis.com/mcp",
				byoClient: GOOGLE_CLIENT,
				scope: "https://www.googleapis.com/auth/cloud-platform",
				authParams: GOOGLE_PARAMS,
			},
		],
	},
	// ---------------------------------------------------------------- data
	{
		id: "supabase",
		name: "Supabase",
		publisher: "Supabase",
		description: "Manage Supabase projects, run SQL and read logs.",
		does: ["Run SQL", "Manage tables and migrations", "Read logs"],
		category: "data",
		docs: "https://supabase.com/docs/guides/getting-started/mcp",
		domain: "supabase.com",
		setups: [
			{ kind: "oauth", url: "https://mcp.supabase.com/mcp" },
			{
				kind: "key",
				url: "https://mcp.supabase.com/mcp",
				header: "Authorization",
				prefix: "Bearer ",
				label: "Personal access token",
				keyUrl: "https://supabase.com/dashboard/account/tokens",
			},
		],
	},
	{
		id: "neon",
		name: "Neon",
		publisher: "Neon",
		description: "Manage Neon Postgres projects, branches and queries.",
		does: ["Create branches", "Run SQL", "Manage projects"],
		category: "data",
		docs: "https://neon.com/docs/ai/neon-mcp-server",
		domain: "neon.com",
		setups: [
			{ kind: "oauth", url: "https://mcp.neon.tech/mcp" },
			{
				kind: "key",
				url: "https://mcp.neon.tech/mcp",
				header: "Authorization",
				prefix: "Bearer ",
				label: "Neon API key",
				keyUrl: "https://console.neon.tech/app/settings/api-keys",
			},
		],
	},
	{
		id: "posthog",
		name: "PostHog",
		publisher: "PostHog",
		description: "Query product analytics, feature flags and experiments.",
		does: ["Ask analytics questions", "Manage feature flags"],
		category: "data",
		docs: "https://posthog.com/docs/model-context-protocol",
		domain: "posthog.com",
		setups: [{ kind: "oauth", url: "https://mcp.posthog.com/mcp" }],
	},
	{
		id: "bigquery",
		name: "BigQuery",
		publisher: "Google Cloud",
		description: "Explore datasets and run BigQuery SQL.",
		does: ["List datasets and tables", "Run SQL"],
		category: "data",
		docs: "https://docs.cloud.google.com/bigquery/docs/use-bigquery-mcp",
		domain: "cloud.google.com",
		setups: [
			{
				kind: "oauth",
				url: "https://bigquery.googleapis.com/mcp",
				byoClient: GOOGLE_CLIENT,
				scope: "https://www.googleapis.com/auth/bigquery",
				authParams: GOOGLE_PARAMS,
			},
		],
	},
	// ---------------------------------------------------------------- search
	{
		id: "exa",
		name: "Exa",
		publisher: "Exa",
		description: "AI web search and page fetching.",
		does: ["Search the web", "Read pages", "Find code and papers"],
		category: "search",
		docs: "https://docs.exa.ai/reference/exa-mcp",
		domain: "exa.ai",
		setups: [
			{ kind: "none", url: "https://mcp.exa.ai/mcp" },
			{
				kind: "key",
				url: "https://mcp.exa.ai/mcp",
				header: "x-api-key",
				label: "Exa API key",
				keyUrl: "https://dashboard.exa.ai/api-keys",
				help: "Optional: higher limits.",
			},
		],
		featured: true,
	},
	{
		id: "tavily",
		name: "Tavily",
		publisher: "Tavily",
		description: "Search, extract and crawl the web.",
		does: ["Search the web", "Extract page content", "Crawl sites"],
		category: "search",
		docs: "https://github.com/tavily-ai/tavily-mcp",
		domain: "tavily.com",
		setups: [
			{ kind: "oauth", url: "https://mcp.tavily.com/mcp/" },
			{
				kind: "key",
				url: "https://mcp.tavily.com/mcp/",
				header: "Authorization",
				prefix: "Bearer ",
				label: "Tavily API key",
				keyUrl: "https://app.tavily.com",
			},
		],
	},
	{
		id: "perplexity",
		name: "Perplexity",
		publisher: "Perplexity",
		description: "Ask Perplexity for cited web answers and research.",
		does: ["Answer with sources", "Deep research"],
		category: "search",
		docs: "https://docs.perplexity.ai/docs/getting-started/integrations/mcp-server",
		domain: "perplexity.ai",
		setups: [
			{
				kind: "key",
				url: "https://api.perplexity.ai/mcp",
				header: "Authorization",
				prefix: "Bearer ",
				label: "Perplexity API key",
				keyUrl: "https://console.perplexity.ai",
			},
		],
	},
	{
		id: "firecrawl",
		name: "Firecrawl",
		publisher: "Firecrawl",
		description: "Scrape, crawl and search websites as clean Markdown.",
		does: ["Scrape pages", "Crawl sites", "Search the web"],
		category: "search",
		docs: "https://github.com/firecrawl/firecrawl-mcp-server",
		domain: "firecrawl.dev",
		setups: [
			{
				kind: "key",
				url: "https://mcp.firecrawl.dev/v2/mcp",
				header: "Authorization",
				prefix: "Bearer ",
				label: "Firecrawl API key",
				keyUrl: "https://www.firecrawl.dev/app/api-keys",
			},
			{ kind: "oauth", url: "https://mcp.firecrawl.dev/v2/mcp-oauth" },
		],
	},
	{
		id: "brave-search",
		name: "Brave Search",
		publisher: "Brave",
		description: "Web, news, image and local search through Brave.",
		does: ["Search the web and news", "Find places"],
		category: "search",
		docs: "https://github.com/brave/brave-search-mcp-server",
		domain: "brave.com",
		setups: [
			{
				kind: "command",
				command: NPX,
				args: ["-y", "@brave/brave-search-mcp-server"],
				env: [
					{
						name: "BRAVE_API_KEY",
						label: "Brave Search API key",
						url: "https://api-dashboard.search.brave.com/app/keys",
					},
				],
			},
		],
	},
	{
		id: "apify",
		name: "Apify",
		publisher: "Apify",
		description: "Run thousands of ready-made scrapers.",
		does: ["Scrape social media and shops", "Run any Apify Actor"],
		category: "search",
		docs: "https://docs.apify.com/platform/integrations/mcp",
		domain: "apify.com",
		setups: [
			{ kind: "oauth", url: "https://mcp.apify.com" },
			{
				kind: "key",
				url: "https://mcp.apify.com",
				header: "Authorization",
				prefix: "Bearer ",
				label: "Apify API token",
				keyUrl: "https://console.apify.com/settings/integrations",
			},
		],
	},
	{
		id: "grep",
		name: "Grep",
		publisher: "Vercel",
		description: "Search code across a million public GitHub repositories.",
		does: ["Find real-world code examples"],
		category: "search",
		docs: "https://grep.app",
		domain: "grep.app",
		setups: [{ kind: "none", url: "https://mcp.grep.app" }],
	},
	// ---------------------------------------------------------------- design
	{
		id: "canva",
		name: "Canva",
		publisher: "Canva",
		description: "Create, search and edit Canva designs.",
		does: ["Make designs from a prompt", "Find and edit designs", "Export"],
		category: "design",
		docs: "https://www.canva.dev/docs/connect/canva-mcp-server-setup/",
		domain: "canva.com",
		setups: [{ kind: "oauth", url: "https://mcp.canva.com/mcp" }],
		featured: true,
	},
	{
		id: "figma",
		name: "Figma (desktop app)",
		publisher: "Figma",
		description: "Design context from the Figma desktop app, for turning designs into code.",
		does: ["Read selected frames", "Get variables and components"],
		category: "design",
		docs: "https://developers.figma.com/docs/figma-mcp-server/",
		domain: "figma.com",
		setups: [{ kind: "none", url: "http://127.0.0.1:3845/mcp" }],
	},
	{
		id: "miro",
		name: "Miro",
		publisher: "Miro",
		description: "Read and create content on Miro boards.",
		does: ["Read boards", "Add stickies, shapes and diagrams"],
		category: "design",
		docs: "https://developers.miro.com/docs/miro-mcp",
		domain: "miro.com",
		setups: [{ kind: "oauth", url: "https://mcp.miro.com/" }],
	},
	{
		id: "webflow",
		name: "Webflow",
		publisher: "Webflow",
		description: "Edit Webflow sites, CMS items and styles.",
		does: ["Edit pages and CMS", "Publish sites"],
		category: "design",
		docs: "https://developers.webflow.com/mcp/reference/overview",
		domain: "webflow.com",
		setups: [{ kind: "oauth", url: "https://mcp.webflow.com/mcp" }],
	},
	{
		id: "wix",
		name: "Wix",
		publisher: "Wix",
		description: "Build and manage Wix sites and business data.",
		does: ["Edit sites", "Manage store and bookings"],
		category: "design",
		docs: "https://dev.wix.com/docs/sdk/articles/use-the-wix-mcp/about-the-wix-mcp",
		domain: "wix.com",
		setups: [{ kind: "oauth", url: "https://mcp.wix.com/mcp" }],
	},
	// ---------------------------------------------------------------- payments
	{
		id: "stripe",
		name: "Stripe",
		publisher: "Stripe",
		description: "Manage Stripe customers and payments, and search Stripe's docs.",
		does: ["Look up payments and customers", "Create payment links and invoices", "Search the docs"],
		category: "finance",
		docs: "https://docs.stripe.com/mcp",
		domain: "stripe.com",
		setups: [
			{ kind: "oauth", url: "https://mcp.stripe.com" },
			{
				kind: "key",
				url: "https://mcp.stripe.com",
				header: "Authorization",
				prefix: "Bearer ",
				label: "Restricted API key",
				keyUrl: "https://dashboard.stripe.com/apikeys",
			},
		],
	},
	{
		id: "paypal",
		name: "PayPal",
		publisher: "PayPal",
		description: "Create invoices and orders, and look up PayPal transactions.",
		does: ["Create invoices", "Look up transactions"],
		category: "finance",
		docs: "https://developer.paypal.com/tools/mcp-server/",
		domain: "paypal.com",
		setups: [{ kind: "oauth", url: "https://mcp.paypal.com/mcp" }],
	},
	{
		id: "square",
		name: "Square",
		publisher: "Block",
		description: "Manage Square payments, catalog, orders and customers.",
		does: ["Look up payments", "Manage catalog and orders"],
		category: "finance",
		docs: "https://developer.squareup.com/docs/mcp",
		domain: "squareup.com",
		setups: [{ kind: "oauth", url: "https://mcp.squareup.com/mcp", loopbackOnly: true }],
	},
	// ---------------------------------------------------------------- browser and local
	{
		id: "playwright",
		name: "Playwright",
		publisher: "Microsoft",
		description: "Drive a real browser on the Sekai server.",
		does: ["Open and click through sites", "Fill in forms", "Take screenshots"],
		category: "browser",
		docs: "https://github.com/microsoft/playwright-mcp",
		domain: "playwright.dev",
		setups: [{ kind: "command", command: NPX, args: ["-y", "@playwright/mcp@latest", "--headless", "--isolated"] }],
	},
	{
		id: "chrome-devtools",
		name: "Chrome DevTools",
		publisher: "Google",
		description: "Debug pages, network and performance in Chrome.",
		does: ["Inspect pages", "Record performance", "Read console and network"],
		category: "browser",
		docs: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
		domain: "developer.chrome.com",
		setups: [{ kind: "command", command: NPX, args: ["-y", "chrome-devtools-mcp@latest", "--headless"] }],
	},
	{
		id: "filesystem",
		name: "Filesystem",
		publisher: "MCP",
		description: "Read and write files in folders on the Sekai server.",
		does: ["Read and write files", "Search folders"],
		category: "other",
		docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
		domain: "modelcontextprotocol.io",
		setups: [
			{
				kind: "command",
				command: NPX,
				args: ["-y", "@modelcontextprotocol/server-filesystem", "<folder>"],
				params: [{ token: "<folder>", label: "Folder", placeholder: "/home/you/Documents" }],
			},
		],
	},
	{
		id: "sequential-thinking",
		name: "Sequential Thinking",
		publisher: "MCP",
		description: "A step-by-step thinking tool for hard problems.",
		does: ["Break problems into steps", "Revise earlier steps"],
		category: "other",
		docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
		domain: "modelcontextprotocol.io",
		setups: [{ kind: "command", command: NPX, args: ["-y", "@modelcontextprotocol/server-sequential-thinking"] }],
	},
	{
		id: "google-maps",
		name: "Google Maps",
		publisher: "Google",
		description: "Places, routes, weather and air quality from Google Maps.",
		does: ["Find places", "Plan routes", "Check weather"],
		category: "other",
		docs: "https://developers.google.com/maps/ai/grounding-lite",
		domain: "maps.google.com",
		setups: [
			{
				kind: "key",
				url: "https://mapstools.googleapis.com/mcp",
				header: "X-Goog-Api-Key",
				label: "Google Maps API key",
				keyUrl: "https://console.cloud.google.com/google/maps-apis/credentials",
				help: "Needs billing and the Maps Experience API (mapstools.googleapis.com) enabled.",
			},
		],
		featured: true,
	},
	{
		id: "home-assistant",
		name: "Home Assistant",
		publisher: "Home Assistant",
		description: "Control your smart home and read its sensors.",
		does: ["Turn devices on and off", "Read sensors", "Run scenes"],
		category: "other",
		docs: "https://www.home-assistant.io/integrations/mcp_server/",
		domain: "home-assistant.io",
		setups: [
			{
				kind: "self-hosted",
				urlTemplate: "{host}/api/mcp",
				hostLabel: "Home Assistant address",
				hostPlaceholder: "http://homeassistant.local:8123",
				header: "Authorization",
				prefix: "Bearer ",
				label: "Long-lived access token",
				help: "Turn on the MCP Server integration in Home Assistant (Settings → Devices & services), then make a long-lived access token on your profile's Security tab.",
			},
		],
	},
];

export function catalogEntry(id: string | null | undefined): McpCatalogEntry | undefined {
	return id ? MCP_CATALOG.find((e) => e.id === id) : undefined;
}
