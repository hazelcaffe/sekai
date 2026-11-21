import { Button, Callout, Link } from "@sekai/ui";
import { UserRoundPlus } from "lucide-react";

/** "2 people want to pair": the requests themselves are answered in Needs you. */
export function PairingNotice({ count }: { count: number }) {
	if (count === 0) return null;
	return (
		<Callout
			tone="warning"
			icon={<UserRoundPlus />}
			title={count === 1 ? "Someone wants to pair" : `${count} people want to pair`}
			action={
				<Button variant="secondary" size="sm" asChild>
					<Link href="/inbox">Open Needs you</Link>
				</Button>
			}
		>
			Check the code is one you just asked for before you approve it.
		</Callout>
	);
}
