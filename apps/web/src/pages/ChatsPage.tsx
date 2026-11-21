import { IconButton, Page, StatusDot, usePlatform } from "@sekai/ui";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { ChatList } from "../components/layout/ChatList.tsx";
import { NewMenu } from "../components/layout/NewMenu.tsx";
import { NoBots } from "../components/layout/NoBots.tsx";
import { PersonAvatar, useSettingsAttention } from "../components/layout/PersonMenu.tsx";
import { SearchButton } from "../components/layout/SearchButton.tsx";

/**
 * Phones: Chats, the first tab. Your avatar on the left opens Settings, New on the right (a floating button on
 * Android), search on top, then the chat list. Opening a chat pushes it full screen.
 */
export function ChatsPage() {
	const navigate = useNavigate();
	const platform = usePlatform();
	const attention = useSettingsAttention();
	const android = platform === "android";
	const newButton = (
		<NewMenu>
			<IconButton label="New">
				<Plus />
			</IconButton>
		</NewMenu>
	);
	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<Page
				title="Chats"
				width="form"
				leading={
					<button
						type="button"
						aria-label={attention ? "Settings: something needs you" : "Settings"}
						onClick={() => navigate("/settings")}
						className="relative ml-1 flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand-ink/40"
					>
						<PersonAvatar size={32} />
						{attention && (
							<StatusDot
								tone={attention}
								label=""
								className="absolute top-1.5 right-1.5 ring-2 ring-bg"
							/>
						)}
					</button>
				}
				actions={android ? undefined : newButton}
			>
				<SearchButton className="-mt-4" />
				<ChatList className="-mx-2 -mt-4 android:pb-8" empty={<NoBots />} />
			</Page>
			{android && (
				<NewMenu>
					<button
						type="button"
						aria-label="New"
						className="absolute right-4 bottom-4 z-sticky flex size-14 items-center justify-center rounded-lg bg-brand-soft text-brand-ink shadow-pop outline-none transition-colors active:bg-brand/30 focus-visible:ring-2 focus-visible:ring-brand-ink/40"
					>
						<Plus className="size-6" />
					</button>
				</NewMenu>
			)}
		</div>
	);
}
