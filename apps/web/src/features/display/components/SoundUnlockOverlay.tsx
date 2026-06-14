/*
 * SoundUnlockOverlay — the one-time "tap to enable sound" overlay (R7.6).
 *
 * Browsers block audio (AudioContext + speech) until a user gesture, so an
 * unattended board cannot chime/announce until someone interacts once. This
 * overlay covers the board on first load and, on tap/click, unlocks audio
 * (resume the AudioContext + prime speech) and dismisses itself. The board only
 * mounts it until sound is unlocked, so it is shown once per session.
 *
 * It is a single full-bleed button: a large, high-contrast, keyboard-reachable
 * tap target suitable for a touch TV/kiosk screen.
 */
import type { ReactElement } from "react";
import { Volume2 } from "lucide-react";

import { strings } from "@/i18n";

/** Props for {@link SoundUnlockOverlay}. */
export interface SoundUnlockOverlayProps {
	/** Called on tap/click to unlock audio and dismiss the overlay. */
	onEnable: () => void;
}

/**
 * The full-screen sound-unlock overlay.
 *
 * @param props - the enable handler.
 */
export function SoundUnlockOverlay({
	onEnable,
}: SoundUnlockOverlayProps): ReactElement {
	return (
		<button
			type="button"
			onClick={onEnable}
			aria-label={strings.display.enableSoundTitle}
			className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-slate-950/95 p-8 text-center text-white focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"
		>
			<Volume2
				className="h-16 w-16 text-amber-300 sm:h-20 sm:w-20"
				aria-hidden="true"
			/>
			<span className="text-3xl font-bold sm:text-5xl">
				{strings.display.enableSoundTitle}
			</span>
			<span className="max-w-2xl text-lg text-slate-300 sm:text-2xl">
				{strings.display.enableSoundBody}
			</span>
			<span className="rounded-xl border-2 border-amber-300 px-8 py-4 text-xl font-semibold text-amber-200 sm:text-2xl">
				{strings.display.enableSoundButton}
			</span>
		</button>
	);
}
