import {
	createContext,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
	type ButtonHTMLAttributes,
	type HTMLAttributes,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactElement,
	type ReactNode,
	type RefObject,
} from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Minimal, self-contained, accessible dropdown menu matching the shadcn/ui
 * `DropdownMenu` composition API (`DropdownMenu` + `Trigger` + `Content` +
 * `RadioItem`/`Item` + `Label` + `Separator`). It is hand-rolled — consistent
 * with the app's other primitives (`button.tsx`, the dialog in
 * `PlanChangeDialog`) — so there is no extra primitive dependency and it can be
 * swapped for the registry component later without changing call sites.
 *
 * Accessibility: the trigger is a real `<button>` with `aria-haspopup="menu"`
 * and `aria-expanded`; the content is a `role="menu"` with arrow-key roving
 * focus, Home/End, Escape-to-close (returning focus to the trigger), and
 * outside-click dismissal. Items are real `<button>`s (so Enter/Space activate
 * natively) exposing `role="menuitem"` / `role="menuitemradio"`.
 */

interface DropdownMenuContextValue {
	open: boolean;
	setOpen: (open: boolean) => void;
	triggerRef: RefObject<HTMLButtonElement | null>;
	contentRef: RefObject<HTMLDivElement | null>;
	triggerId: string;
	contentId: string;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(
	null,
);

function useDropdownMenuContext(): DropdownMenuContextValue {
	const context = useContext(DropdownMenuContext);
	if (context === null) {
		throw new Error(
			"DropdownMenu components must be rendered within <DropdownMenu>.",
		);
	}
	return context;
}

/** CSS selector matching the focusable, non-disabled menu items. */
const MENU_ITEM_SELECTOR =
	'[role="menuitem"]:not([aria-disabled="true"]),[role="menuitemradio"]:not([aria-disabled="true"]),[role="menuitemcheckbox"]:not([aria-disabled="true"])';

/** Props for {@link DropdownMenu}. */
export interface DropdownMenuProps {
	children: ReactNode;
	/** Notified whenever the menu opens or closes. */
	onOpenChange?: (open: boolean) => void;
}

/** Root that owns the open state and wires outside-click dismissal. */
export function DropdownMenu({
	children,
	onOpenChange,
}: DropdownMenuProps): ReactElement {
	const [open, setOpenState] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const triggerId = useId();
	const contentId = useId();

	const setOpen = (next: boolean): void => {
		setOpenState(next);
		onOpenChange?.(next);
	};

	useEffect(() => {
		if (!open) {
			return;
		}
		const onPointerDown = (event: MouseEvent): void => {
			const target = event.target as Node | null;
			if (
				target !== null &&
				triggerRef.current?.contains(target) !== true &&
				contentRef.current?.contains(target) !== true
			) {
				setOpenState(false);
				onOpenChange?.(false);
			}
		};
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [open, onOpenChange]);

	return (
		<DropdownMenuContext.Provider
			value={{ open, setOpen, triggerRef, contentRef, triggerId, contentId }}
		>
			<div className="relative inline-block text-left">{children}</div>
		</DropdownMenuContext.Provider>
	);
}

/** Props for {@link DropdownMenuTrigger}. */
export type DropdownMenuTriggerProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** The button that toggles the menu. */
export function DropdownMenuTrigger({
	className,
	onClick,
	onKeyDown,
	...props
}: DropdownMenuTriggerProps): ReactElement {
	const { open, setOpen, triggerRef, triggerId, contentId } =
		useDropdownMenuContext();

	return (
		<button
			ref={triggerRef}
			id={triggerId}
			type="button"
			aria-haspopup="menu"
			aria-expanded={open}
			aria-controls={open ? contentId : undefined}
			className={className}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented) {
					setOpen(!open);
				}
			}}
			onKeyDown={(event) => {
				onKeyDown?.(event);
				if (event.defaultPrevented) {
					return;
				}
				// Open on ArrowDown/Up/Enter/Space so the menu is keyboard-reachable.
				if (
					event.key === "ArrowDown" ||
					event.key === "ArrowUp" ||
					event.key === "Enter" ||
					event.key === " "
				) {
					event.preventDefault();
					setOpen(true);
				}
			}}
			{...props}
		/>
	);
}

/** Props for {@link DropdownMenuContent}. */
export type DropdownMenuContentProps = HTMLAttributes<HTMLDivElement>;

/** The popup menu surface; rendered only while the menu is open. */
export function DropdownMenuContent({
	className,
	children,
	...props
}: DropdownMenuContentProps): ReactElement | null {
	const { open, setOpen, triggerRef, contentRef, contentId, triggerId } =
		useDropdownMenuContext();

	// On open, move focus to the checked item (or the first item) so keyboard
	// users land inside the menu; this also satisfies the visible-focus rule.
	useEffect(() => {
		if (!open) {
			return;
		}
		const content = contentRef.current;
		if (content === null) {
			return;
		}
		const items = Array.from(
			content.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR),
		);
		const checked = items.find(
			(item) => item.getAttribute("aria-checked") === "true",
		);
		(checked ?? items[0])?.focus();
	}, [open, contentRef]);

	if (!open) {
		return null;
	}

	const moveFocus = (delta: 1 | -1): void => {
		const content = contentRef.current;
		if (content === null) {
			return;
		}
		const items = Array.from(
			content.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR),
		);
		if (items.length === 0) {
			return;
		}
		const activeElement = content.ownerDocument.activeElement;
		const currentIndex = items.findIndex((item) => item === activeElement);
		const nextIndex =
			currentIndex === -1
				? delta === 1
					? 0
					: items.length - 1
				: (currentIndex + delta + items.length) % items.length;
		items[nextIndex]?.focus();
	};

	const closeAndReturnFocus = (): void => {
		setOpen(false);
		triggerRef.current?.focus();
	};

	return (
		<div
			ref={contentRef}
			id={contentId}
			role="menu"
			aria-labelledby={triggerId}
			tabIndex={-1}
			className={cn(
				"absolute left-0 z-50 mt-2 min-w-[12rem] overflow-hidden rounded-md border border-border bg-background p-1 shadow-md focus:outline-none",
				className,
			)}
			onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
				switch (event.key) {
					case "ArrowDown":
						event.preventDefault();
						moveFocus(1);
						break;
					case "ArrowUp":
						event.preventDefault();
						moveFocus(-1);
						break;
					case "Home": {
						event.preventDefault();
						const first =
							contentRef.current?.querySelector<HTMLElement>(
								MENU_ITEM_SELECTOR,
							);
						first?.focus();
						break;
					}
					case "End": {
						event.preventDefault();
						const all =
							contentRef.current?.querySelectorAll<HTMLElement>(
								MENU_ITEM_SELECTOR,
							);
						all?.[all.length - 1]?.focus();
						break;
					}
					case "Escape":
						event.preventDefault();
						closeAndReturnFocus();
						break;
					case "Tab":
						// Let focus leave naturally, but collapse the menu.
						setOpen(false);
						break;
					default:
						break;
				}
			}}
			{...props}
		>
			{children}
		</div>
	);
}

/** Shared props for the selectable menu entries. */
interface DropdownMenuItemBaseProps
	extends ButtonHTMLAttributes<HTMLButtonElement> {
	/** Disable selection while keeping the entry visible (e.g. a switch in flight). */
	disabled?: boolean;
}

/** Props for {@link DropdownMenuItem}. */
export type DropdownMenuItemProps = DropdownMenuItemBaseProps;

/** A plain, activatable menu entry (`role="menuitem"`). */
export function DropdownMenuItem({
	className,
	disabled = false,
	onClick,
	...props
}: DropdownMenuItemProps): ReactElement {
	const { setOpen } = useDropdownMenuContext();

	return (
		<button
			type="button"
			role="menuitem"
			tabIndex={-1}
			aria-disabled={disabled || undefined}
			disabled={disabled}
			className={cn(
				"flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none",
				"hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
				"disabled:pointer-events-none disabled:opacity-50",
				className,
			)}
			onClick={(event) => {
				if (disabled) {
					return;
				}
				onClick?.(event);
				if (!event.defaultPrevented) {
					setOpen(false);
				}
			}}
			{...props}
		/>
	);
}

/** Props for {@link DropdownMenuRadioItem}. */
export interface DropdownMenuRadioItemProps extends DropdownMenuItemBaseProps {
	/** Whether this entry is the selected one (`aria-checked`, leading check icon). */
	checked: boolean;
}

/**
 * A single-select menu entry (`role="menuitemradio"`). The persistent selected
 * marker is a leading check icon plus `aria-checked`, so the selection is
 * conveyed without relying on color alone.
 */
export function DropdownMenuRadioItem({
	className,
	checked,
	disabled = false,
	children,
	onClick,
	...props
}: DropdownMenuRadioItemProps): ReactElement {
	const { setOpen } = useDropdownMenuContext();

	return (
		<button
			type="button"
			role="menuitemradio"
			aria-checked={checked}
			tabIndex={-1}
			aria-disabled={disabled || undefined}
			disabled={disabled}
			className={cn(
				"relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-2 pl-8 pr-2 text-left text-sm outline-none",
				"hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
				"disabled:pointer-events-none disabled:opacity-50",
				className,
			)}
			onClick={(event) => {
				if (disabled) {
					return;
				}
				onClick?.(event);
				if (!event.defaultPrevented) {
					setOpen(false);
				}
			}}
			{...props}
		>
			<span className="absolute left-2 flex h-4 w-4 items-center justify-center">
				{checked ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
			</span>
			{children}
		</button>
	);
}

/** Props for {@link DropdownMenuLabel}. */
export type DropdownMenuLabelProps = HTMLAttributes<HTMLDivElement>;

/** A non-interactive heading inside the menu. */
export function DropdownMenuLabel({
	className,
	...props
}: DropdownMenuLabelProps): ReactElement {
	return (
		<div
			className={cn(
				"px-2 py-1.5 text-xs font-medium text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

/** A thin visual divider between menu groups. */
export function DropdownMenuSeparator({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>): ReactElement {
	return (
		<div
			role="separator"
			className={cn("-mx-1 my-1 h-px bg-border", className)}
			{...props}
		/>
	);
}
