import { SkeletonPage } from "@sekai/ui";

/** A page that's loading (a Settings or bot section's file, its data): shaped like a page, padded like one. */
export function PageLoading() {
	return (
		<div className="mx-auto w-full max-w-form flex-1 px-4 pt-safe-4 md:px-6 md:pt-8 lg:px-8 lg:pt-10">
			<SkeletonPage />
		</div>
	);
}
