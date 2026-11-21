import {
	Badge,
	Button,
	Callout,
	Checkbox,
	CodeInput,
	Confirm,
	ContextMenu,
	CopyField,
	Dialog,
	DropdownContent,
	DropdownEntries,
	DropdownMenu,
	DropdownTrigger,
	EmptyState,
	ErrorBoundary,
	ErrorState,
	Field,
	Fold,
	FormGroup,
	IconButton,
	IconTile,
	Input,
	Kbd,
	List,
	type MenuEntry,
	Page,
	PasswordInput,
	Popover,
	Row,
	SaveState,
	Section,
	SectionLayout,
	Segmented,
	Select,
	SelectRow,
	Sheet,
	SkeletonChat,
	SkeletonPage,
	SkeletonRows,
	Spinner,
	StatusDot,
	Switch,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	Textarea,
	THEMES,
	type ThemeId,
	Toaster,
	ToggleRow,
	type Tone,
	Tooltip,
	useAutosave,
	useFormValues,
} from "@sekai/ui";
import {
	Bell,
	Bot,
	Copy,
	Cpu,
	FileText,
	Inbox,
	KeyRound,
	Mic,
	Palette,
	Pencil,
	Plus,
	Search,
	Settings,
	Shield,
	Trash2,
	UserRound,
	Users,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Every building block in its states, for building screens and reviewing them: /dev/ui in the dev server only (the
 * route and this file are left out of production builds). The page shows the blocks in frames of a chosen width,
 * theme and platform; each frame is this same page with ?frame.
 */
export default function Gallery() {
	const params = new URLSearchParams(location.search);
	if (params.has("frame"))
		return <Frame theme={(params.get("theme") as ThemeId) ?? "vs"} platform={params.get("platform") ?? "web"} />;
	return <Viewer />;
}

const WIDTHS = { phone: 390, tablet: 834, desktop: 1280 } as const;
type Width = keyof typeof WIDTHS | "both";

function Viewer() {
	const [theme, setTheme] = useState<ThemeId>("vs");
	const [platform, setPlatform] = useState("web");
	const [width, setWidth] = useState<Width>("both");
	useEffect(() => {
		document.title = "Building blocks · Sekai";
		document.documentElement.dataset.theme = "vs";
		document.documentElement.classList.remove("dark");
	}, []);
	const src = (w: number) => `/dev/ui?frame&theme=${theme}&platform=${platform}&w=${w}`;
	const frames: number[] = width === "both" ? [WIDTHS.phone, WIDTHS.desktop] : [WIDTHS[width]];
	return (
		<div className="flex h-dvh flex-col bg-bg-subtle">
			<header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-bg px-4 py-2.5">
				<div className="text-heading font-semibold">Building blocks</div>
				<Select
					size="sm"
					label="Theme"
					className="w-56"
					value={theme}
					onValueChange={(v) => setTheme(v as ThemeId)}
					options={THEMES.map((t) => ({ value: t.id, label: `${t.name} (${t.mode})` }))}
				/>
				<Segmented
					size="sm"
					label="Platform"
					value={platform}
					onValueChange={setPlatform}
					options={[
						{ value: "web", label: "Web" },
						{ value: "ios", label: "iOS" },
						{ value: "android", label: "Android" },
					]}
				/>
				<Segmented
					size="sm"
					label="Width"
					value={width}
					onValueChange={setWidth}
					options={[
						{ value: "both", label: "Phone + desktop" },
						{ value: "phone", label: "Phone" },
						{ value: "tablet", label: "Tablet" },
						{ value: "desktop", label: "Desktop" },
					]}
				/>
			</header>
			<div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
				{frames.map((w) => (
					<iframe
						key={`${w}-${theme}-${platform}`}
						title={`Building blocks at ${w}px`}
						src={src(w)}
						style={{ width: w }}
						className="h-full shrink-0 rounded-lg border border-border bg-bg shadow-soft"
					/>
				))}
			</div>
		</div>
	);
}

function Frame({ theme, platform }: { theme: ThemeId; platform: string }) {
	const info = THEMES.find((t) => t.id === theme) ?? THEMES[0];
	useEffect(() => {
		const html = document.documentElement;
		html.dataset.theme = theme;
		html.dataset.platform = platform;
		html.classList.toggle("dark", info?.mode === "dark");
		html.style.colorScheme = info?.mode ?? "light";
	}, [theme, platform, info]);
	return (
		<>
			<Page
				title="Building blocks"
				description="Everything screens are made of, in every state."
				width="wide"
				scroll="document"
				actions={
					<IconButton label="Search" onClick={() => toast("Search isn't part of the gallery.")}>
						<Search />
					</IconButton>
				}
			>
				<TypeAndColour />
				<Buttons />
				<Lists />
				<Forms />
				<Saving />
				<Overlays />
				<Status />
				<States />
				<Layouts />
			</Page>
			<Toaster theme={info?.mode ?? "light"} />
		</>
	);
}

// ---------------------------------------------------------------- sections

function TypeAndColour() {
	const roles = ["caption", "small", "body", "message", "heading", "title", "display"] as const;
	const roleClass: Record<(typeof roles)[number], string> = {
		caption: "text-caption",
		small: "text-small",
		body: "text-body",
		message: "text-message",
		heading: "text-heading font-semibold",
		title: "text-title font-semibold",
		display: "text-display font-semibold",
	};
	const swatches = [
		["bg", "bg-bg"],
		["bg-subtle", "bg-bg-subtle"],
		["surface", "bg-surface"],
		["surface-2", "bg-surface-2"],
		["surface-3", "bg-surface-3"],
		["brand", "bg-brand"],
		["brand-soft", "bg-brand-soft"],
		["danger-soft", "bg-danger-soft"],
		["warning-soft", "bg-warning-soft"],
		["success-soft", "bg-success-soft"],
		["info-soft", "bg-info-soft"],
	] as const;
	const inks = [
		["fg", "text-fg"],
		["fg-muted", "text-fg-muted"],
		["fg-subtle", "text-fg-subtle"],
		["brand-ink", "text-brand-ink"],
		["danger-ink", "text-danger-ink"],
		["warning-ink", "text-warning-ink"],
		["success-ink", "text-success-ink"],
		["info-ink", "text-info-ink"],
	] as const;
	return (
		<Section title="Type and colour" description="Type roles change size on touch screens, iOS and Android.">
			<div className="flex flex-col gap-2">
				{roles.map((r) => (
					<div key={r} className="flex items-baseline gap-4">
						<span className="w-20 shrink-0 font-mono text-caption text-fg-subtle">{r}</span>
						<span className={`${roleClass[r]} min-w-0 truncate`}>Nori finished the print proof</span>
					</div>
				))}
			</div>
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
				{swatches.map(([name, cls]) => (
					<div key={name} className="flex flex-col gap-1.5">
						<div className={`h-12 rounded-md border border-border ${cls}`} />
						<span className="font-mono text-caption text-fg-subtle">{name}</span>
					</div>
				))}
			</div>
			<div className="flex flex-wrap gap-x-5 gap-y-1">
				{inks.map(([name, cls]) => (
					<span key={name} className={`text-body font-medium ${cls}`}>
						{name}
					</span>
				))}
			</div>
		</Section>
	);
}

function Buttons() {
	const [busy, setBusy] = useState(false);
	return (
		<Section title="Buttons" description="One primary action per view; the rest are secondary or ghost.">
			<div className="flex flex-wrap items-center gap-2">
				<Button variant="primary">Save</Button>
				<Button variant="secondary">Cancel</Button>
				<Button variant="outline">Outline</Button>
				<Button variant="ghost">Ghost</Button>
				<Button variant="brand">Start a call</Button>
				<Button variant="danger">Delete</Button>
				<Button variant="danger-ghost">Remove</Button>
				<Button variant="link">Learn more</Button>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button size="xs">Extra small</Button>
				<Button size="sm">
					<Plus /> Small
				</Button>
				<Button>Medium</Button>
				<Button size="lg">Large</Button>
				<Button
					variant="primary"
					loading={busy}
					onClick={() => {
						setBusy(true);
						setTimeout(() => setBusy(false), 1500);
					}}
				>
					<KeyRound /> Connect
				</Button>
				<Button disabled>Disabled</Button>
			</div>
			<div className="flex flex-wrap items-center gap-1">
				<IconButton label="Copy">
					<Copy />
				</IconButton>
				<IconButton label="Edit" size="icon-sm">
					<Pencil />
				</IconButton>
				<IconButton label="Delete" size="icon-xs" variant="danger-ghost">
					<Trash2 />
				</IconButton>
				<IconButton label="New chat" variant="primary" size="icon" pill shortcut="⌘N">
					<Plus />
				</IconButton>
				<span className="ml-2 text-small text-fg-muted">
					Shortcuts: <Kbd>⌘</Kbd> <Kbd>K</Kbd>
				</span>
			</div>
		</Section>
	);
}

function Lists() {
	const [on, setOn] = useState(true);
	const [model, setModel] = useState("haiku");
	const [picked, setPicked] = useState("profile");
	const menu: MenuEntry[] = [
		{ label: "Rename", icon: <Pencil />, onSelect: () => toast("Rename") },
		{ label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => toast("Deleted") },
		{ label: "Copy link", icon: <Copy />, onSelect: () => toast("Copied") },
	];
	return (
		<Section
			title="Lists and rows"
			description="An inset group with hairlines. Right-click or touch and hold a row with a menu."
			action={
				<Button size="sm" variant="secondary">
					<Plus /> Add someone
				</Button>
			}
		>
			<List>
				<Row icon={<UserRound />} title="Profile" subtitle="Name and time zone" href="#profile" />
				<Row icon={<Palette />} title="Appearance" value="Virtual Singers" href="#appearance" />
				<Row
					leading={<Avatar letter="M" />}
					title="Mika Aoki"
					subtitle="@mika · never signed in"
					badge={<Badge tone="warning">Temporary password</Badge>}
					menu={menu}
					menuLabel="More for Mika Aoki"
				/>
				<Row
					leading={<Avatar letter="N" dot={<StatusDot tone="brand" label="Working" size="sm" />} />}
					title="Nori"
					subtitle="Checking the print proof"
					onClick={() => toast("Opened Nori")}
					chevron
				/>
				<Row
					icon={<FileText />}
					title="Read page 3 of a document"
					subtitle="Nori · Allowed by you"
					value="9:15"
					details={<p className="text-fg-muted">What it shows when opened: arguments, the result, a link.</p>}
				/>
				<ToggleRow
					icon={<Bell />}
					title="Notifications"
					description="On this device"
					checked={on}
					onCheckedChange={setOn}
				/>
				<SelectRow
					icon={<Cpu />}
					title="Model"
					value={model}
					onValueChange={setModel}
					options={[
						{ value: "haiku", label: "Haiku 4.5" },
						{ value: "sonnet", label: "Sonnet 4.5", description: "Better at long tasks" },
						{ value: "opus", label: "Opus 4.5" },
					]}
				/>
				<Row icon={<Shield />} title="Can't change this" subtitle="Your role doesn't allow it" disabled />
				<Row
					icon={<Trash2 />}
					iconTone="danger"
					title="Delete this bot"
					danger
					onClick={() => toast("Asks first")}
				/>
			</List>
			<div className="flex flex-col gap-0.5">
				{["Moss", "Pico"].map((name) => (
					<Row
						key={name}
						className="rounded-lg px-2"
						leading={<Avatar letter={name[0] ?? "?"} />}
						title={name}
						subtitle="The last message, cut short only by the row's own end"
						badge={<StatusDot tone="brand" label="Unread" />}
						onClick={() => toast(`Opened ${name}`)}
						menu={menu}
						menuLabel={`More for ${name}`}
						menuButton="hover"
					/>
				))}
			</div>
			<List label="Pick one">
				{["profile", "model", "memory"].map((id) => (
					<Row
						key={id}
						title={id[0]?.toUpperCase() + id.slice(1)}
						selected={picked === id}
						onClick={() => setPicked(id)}
						trailing={picked === id ? <Badge tone="brand">Selected</Badge> : undefined}
					/>
				))}
			</List>
		</Section>
	);
}

function Avatar({ letter, dot }: { letter: string; dot?: ReactNode }) {
	return (
		<span className="relative flex size-8 items-center justify-center rounded-full bg-brand-soft text-caption font-semibold text-brand-ink">
			{letter}
			{dot && <span className="absolute -right-0.5 -bottom-0.5 rounded-full bg-surface p-0.5">{dot}</span>}
		</span>
	);
}

function Forms() {
	const [code, setCode] = useState("");
	const [agree, setAgree] = useState(false);
	const [sw, setSw] = useState(false);
	const [seg, setSeg] = useState("auto");
	const [sel, setSel] = useState("");
	return (
		<Section title="Fields" description="Label above, one-line hint below, the error under that.">
			<div className="grid gap-4 md:grid-cols-2">
				<Field label="Name" hint="How your bots address you.">
					<Input placeholder="e.g. Hazel" />
				</Field>
				<Field label="Label" optional hint="Shown under the name.">
					<Input placeholder="e.g. Studio coordinator" />
				</Field>
				<Field label="Proxmox address" error="Couldn't reach it. Check the address and try again.">
					<Input defaultValue="https://pve.local:8006" />
				</Field>
				<Field label="Password">
					<PasswordInput defaultValue="hunter2" />
				</Field>
				<Field label="Time zone">
					<Select
						value={sel}
						onValueChange={setSel}
						placeholder="Pick one"
						options={[
							{ value: "europe/london", label: "London" },
							{ value: "asia/tokyo", label: "Tokyo" },
						]}
					/>
				</Field>
				<Field label="Setup code">
					<CodeInput value={code} onChange={setCode} />
				</Field>
				<Field label="Instructions" className="md:col-span-2">
					<Textarea placeholder="e.g. Keep answers short." />
				</Field>
				<Field label="Redirect URL" hint="Paste it into the provider's settings.">
					<CopyField label="redirect URL" value="https://sekai.example.com/api/auth/sso/callback" />
				</Field>
				<Field label="Run this on the device">
					<CopyField
						multiline
						label="install command"
						value="mkdir -p ~/.ssh && echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKq sekai' >> ~/.ssh/authorized_keys"
					/>
				</Field>
				<div className="flex flex-col gap-1.5 md:col-span-2">
					<CopyField showLabel label="SSH" value="ssh nori@nori-computer.tailnet.ts.net" />
					<CopyField showLabel secret label="root" value="correct horse battery staple" />
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-6">
				<Checkbox
					label="Skip quiet days"
					description="No digest when nothing happened."
					checked={agree}
					onCheckedChange={setAgree}
				/>
				<Switch label="A switch" checked={sw} onCheckedChange={setSw} />
				<Segmented
					label="Thinking"
					value={seg}
					onValueChange={setSeg}
					options={[
						{ value: "auto", label: "Auto" },
						{ value: "low", label: "Low" },
						{ value: "high", label: "High" },
					]}
				/>
			</div>
		</Section>
	);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Saving() {
	const [fail, setFail] = useState(false);
	const saved = { host: "pve.local", user: "root@pam" };
	const [server, setServer] = useState(saved);
	const form = useFormValues(server);
	const [learn, setLearn] = useState(true);
	const autosave = useAutosave(async (v: boolean) => {
		await wait(700);
		if (fail) throw new Error("The server didn't answer. Try again in a moment.");
		return v;
	});
	return (
		<>
			<Section
				title="Saves itself"
				description="Switches, selects and short fields: Saving…, then Saved."
				saveState={<SaveState state={autosave} />}
			>
				<List>
					<ToggleRow
						title="Learns as it goes"
						description="Remembers what matters from your chats."
						checked={learn}
						onCheckedChange={(v) => {
							setLearn(v);
							autosave.save(v);
						}}
					/>
					<ToggleRow title="Make saving fail" checked={fail} onCheckedChange={setFail} />
				</List>
			</Section>
			<Section title="Explicit save" description="Connections, credentials and policies: Save and Cancel.">
				<FormGroup
					dirty={form.dirty}
					onCancel={() => form.reset()}
					submitLabel="Connect"
					extra={
						<Button variant="ghost" onClick={() => toast.success("Proxmox answered.")}>
							Test
						</Button>
					}
					onSubmit={async () => {
						await wait(800);
						if (fail) throw new Error("Couldn't reach Proxmox. Check the address and try again.");
						setServer(form.values);
					}}
				>
					<div className="grid gap-4 md:grid-cols-2">
						<Field label="Address">
							<Input value={form.values.host} onChange={(e) => form.set("host", e.target.value)} />
						</Field>
						<Field label="User">
							<Input value={form.values.user} onChange={(e) => form.set("user", e.target.value)} />
						</Field>
					</div>
				</FormGroup>
			</Section>
		</>
	);
}

function Overlays() {
	const [dialog, setDialog] = useState(false);
	const [confirm, setConfirm] = useState(false);
	const [sheet, setSheet] = useState(false);
	const entries: MenuEntry[] = [
		{ label: "New chat", icon: <Plus />, onSelect: () => toast("New chat"), shortcut: "⌘N" },
		{ label: "Delete chat", icon: <Trash2 />, danger: true, onSelect: () => setConfirm(true) },
		"-",
		{ label: "Bot settings", icon: <Settings />, onSelect: () => toast("Bot settings") },
	];
	return (
		<Section title="Overlays" description="Menus open as an action sheet on phones; destructive entries go last.">
			<div className="flex flex-wrap items-center gap-2">
				<Button onClick={() => setDialog(true)}>Dialog</Button>
				<Button onClick={() => setConfirm(true)}>Confirm</Button>
				<Button onClick={() => setSheet(true)}>Side sheet</Button>
				<DropdownMenu>
					<DropdownTrigger asChild>
						<Button>Menu</Button>
					</DropdownTrigger>
					<DropdownContent title="Chat">
						<DropdownEntries entries={entries} />
					</DropdownContent>
				</DropdownMenu>
				<Popover trigger={<Button>Popover</Button>}>
					<div className="p-2 text-body">A popover holds a little more than a tooltip.</div>
				</Popover>
				<Tooltip content="A tooltip">
					<Button variant="ghost">Hover me</Button>
				</Tooltip>
				<Button onClick={() => toast.success("Backup finished")}>Toast</Button>
				<Button
					onClick={() =>
						toast("Chat deleted", { action: { label: "Undo", onClick: () => toast("Restored") } })
					}
				>
					Toast with Undo
				</Button>
				<Button onClick={() => toast.error("Couldn't reach Sekai. Check your connection and try again.")}>
					Error toast
				</Button>
			</div>
			<ContextMenu entries={entries} label="Chat">
				<div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border-strong text-small text-fg-muted">
					Right-click, or touch and hold
				</div>
			</ContextMenu>
			<Dialog
				open={dialog}
				onOpenChange={setDialog}
				title="New group"
				description="A chat with several bots."
				footer={
					<>
						<Button variant="ghost" onClick={() => setDialog(false)}>
							Cancel
						</Button>
						<Button variant="primary" onClick={() => setDialog(false)}>
							Create
						</Button>
					</>
				}
			>
				<Field label="Name">
					<Input placeholder="e.g. Editorial table" />
				</Field>
			</Dialog>
			<Confirm
				open={confirm}
				onOpenChange={setConfirm}
				title="Delete this chat?"
				description="Its messages will be deleted for good. Nori keeps what it remembers."
				confirmLabel="Delete"
				danger
				onConfirm={() => toast("Deleted")}
			/>
			<Sheet open={sheet} onOpenChange={setSheet} title="Chat details">
				<div className="p-4">
					<Section title="Chat details">
						<p className="text-body text-fg-muted">A side sheet: tablets and phones.</p>
						<Button onClick={() => setSheet(false)}>Close</Button>
					</Section>
				</div>
			</Sheet>
		</Section>
	);
}

function Status() {
	const tones: Tone[] = ["neutral", "brand", "info", "success", "warning", "danger"];
	return (
		<Section title="Status" description="A word of status, live state, and notices.">
			<div className="flex flex-wrap items-center gap-2">
				{tones.map((t) => (
					<Badge key={t} tone={t}>
						{t[0]?.toUpperCase() + t.slice(1)}
					</Badge>
				))}
			</div>
			<div className="flex flex-wrap items-center gap-5 text-small text-fg-muted">
				<span className="flex items-center gap-2">
					<StatusDot tone="success" label="Running" /> Running
				</span>
				<span className="flex items-center gap-2">
					<StatusDot tone="brand" label="Working" /> Working
				</span>
				<span className="flex items-center gap-2">
					<StatusDot tone="warning" label="Needs you" /> Needs you
				</span>
				<span className="flex items-center gap-2">
					<StatusDot tone="danger" label="Broken" /> Broken
				</span>
				<span className="flex items-center gap-2">
					<StatusDot tone="neutral" label="Off" /> Off
				</span>
			</div>
			<div className="flex flex-wrap gap-2">
				{tones.map((t) => (
					<IconTile key={t} tone={t}>
						<Bot />
					</IconTile>
				))}
			</div>
			<div className="flex flex-col gap-2">
				<Callout tone="warning" icon={<Shield />} title="Approvals are off">
					Bots act without asking. Turn them back on in Approvals.
				</Callout>
				<Callout
					tone="danger"
					icon={<KeyRound />}
					title="Codex needs you to sign in again"
					action={<Button size="sm">Sign in</Button>}
				>
					Bots using it can't answer until then.
				</Callout>
				<Callout tone="info">A plain notice, no title.</Callout>
			</div>
			<Tabs defaultValue="working">
				<TabsList>
					<TabsTrigger value="working">Working</TabsTrigger>
					<TabsTrigger value="scheduled">Scheduled</TabsTrigger>
					<TabsTrigger value="done">Done</TabsTrigger>
				</TabsList>
				<TabsContent value="working" className="pt-3 text-body text-fg-muted">
					Underline tabs switch between peers inside a page.
				</TabsContent>
				<TabsContent value="scheduled" className="pt-3 text-body text-fg-muted">
					Routines and reminders.
				</TabsContent>
				<TabsContent value="done" className="pt-3 text-body text-fg-muted">
					What bots did.
				</TabsContent>
			</Tabs>
			<Fold title="Advanced" summary="2 settings">
				<p className="text-body text-fg-muted">Rarely used settings live here, folded.</p>
			</Fold>
			<Fold variant="link" title="Learn more">
				Bots on a shared computer each get their own account on it.
			</Fold>
		</Section>
	);
}

function Crash({ crash }: { crash: boolean }) {
	if (crash) throw new Error("A screen broke");
	return <p className="text-body text-fg-muted">This part of the page works.</p>;
}

function States() {
	const [crash, setCrash] = useState(false);
	return (
		<Section title="Empty, error and loading">
			<div className="grid gap-4 md:grid-cols-2">
				<div className="rounded-lg border border-border">
					<EmptyState
						icon={<Inbox />}
						title="Nothing needs you"
						description="Approvals and sign-in requests show up here."
						action={<Button size="sm">See activity</Button>}
					/>
				</div>
				<div className="rounded-lg border border-border">
					<ErrorState error={new TypeError("Failed to fetch")} onRetry={() => toast("Trying again")} />
				</div>
				<div className="flex flex-col gap-3 rounded-lg border border-border p-4">
					<ErrorBoundary resetKey={crash ? "broken" : "fine"}>
						<Crash crash={crash} />
					</ErrorBoundary>
					<Button size="sm" variant="secondary" className="self-start" onClick={() => setCrash((c) => !c)}>
						{crash ? "Fix it" : "Break it"}
					</Button>
				</div>
				<div className="flex items-center gap-2 rounded-lg border border-border p-4 text-body text-fg-muted">
					<Spinner /> A spinner, only in a working button or a takeover.
				</div>
			</div>
			<SkeletonRows count={3} />
			<div className="grid gap-4 md:grid-cols-2">
				<div className="rounded-lg border border-border p-4">
					<SkeletonPage />
				</div>
				<div className="rounded-lg border border-border">
					<SkeletonChat />
				</div>
			</div>
		</Section>
	);
}

function Layouts() {
	const [active, setActive] = useState<string | null>("profile");
	const items = [
		{ id: "profile", title: "Profile", icon: <UserRound /> },
		{ id: "appearance", title: "Appearance", icon: <Palette /> },
		{ id: "notifications", title: "Notifications", icon: <Bell />, badge: <Badge tone="warning">1</Badge> },
	];
	const bots = [
		{ id: "models", title: "Models", icon: <Cpu /> },
		{ id: "voice", title: "Voice", icon: <Mic /> },
		{ id: "people", title: "People", icon: <Users /> },
	];
	const all = [...items, ...bots];
	const current = all.find((i) => i.id === active);
	return (
		<Section
			title="Page and section layout"
			description="Settings and a bot: a rail on wide screens, pushed pages on phones."
		>
			<div className="flex h-[560px] overflow-hidden rounded-lg border border-border">
				<SectionLayout
					title="Settings"
					active={active}
					groups={[
						{
							id: "you",
							title: "You",
							items: items.map((i) => ({ ...i, onSelect: () => setActive(i.id) })),
						},
						{
							id: "bots",
							title: "Bots",
							items: bots.map((i) => ({ ...i, onSelect: () => setActive(i.id) })),
						},
					]}
				>
					{current && (
						<Page
							title={current.title}
							description="A section's page: its title, one line, then sections."
							back={{ label: "Settings", onClick: () => setActive(null) }}
						>
							<Section
								title="Something"
								saveState={<span className="text-small text-fg-subtle">Saved</span>}
							>
								<List>
									<Row title="A row" value="A value" />
									<Row title="Another row" href="#another" />
								</List>
							</Section>
						</Page>
					)}
				</SectionLayout>
			</div>
		</Section>
	);
}
