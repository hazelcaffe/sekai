/**
 * A field's edge at rest: a firm bottom line (border-strong, 3:1 on every ground) on the quiet tint, so you can see
 * where the field is without a full outline (Material's filled field). Focus and errors colour all four sides.
 */
export const fieldEdge = "border border-transparent border-b-border-strong";

/**
 * Sekai's soft, filled text fields: a quiet tint with a firm bottom edge at rest, a crisp brand-ink edge when
 * focused. 16px text on touch screens (text-body there), so iOS doesn't zoom in. 12px corners on Android (Material 3).
 */
export const fieldStyles = `${fieldEdge} w-full min-w-0 rounded-md bg-surface-2 px-3 text-body text-fg outline-none transition-[background-color,border-color,box-shadow] duration-fast placeholder:text-fg-subtle hover:bg-surface-hover focus-visible:border-ring focus-visible:bg-bg focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger-ink aria-invalid:ring-[3px] aria-invalid:ring-danger/15 android:rounded-lg`;
