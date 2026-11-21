import { ErrorState } from "@sekai/ui";

/** Hardware and network drivers can return command output; don't print it as a query error. */
export function LoadProblem({ what, retry }: { what: string; retry: () => unknown }) {
	return (
		<ErrorState
			size="sm"
			title={`Couldn’t load ${what}`}
			description="Check the connection and try again."
			onRetry={retry}
		/>
	);
}
