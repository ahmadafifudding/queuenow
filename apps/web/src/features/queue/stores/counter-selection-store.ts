/*
 * Counter-selection store — EPHEMERAL UI state for the queue panel (R6.2).
 *
 * The active counter a staff member is serving from is a UI selection, not
 * server data, so per steering "State Management" it lives in a small,
 * feature-scoped Zustand slice rather than TanStack Query. We intentionally do
 * NOT duplicate any server-owned counter data here — only the id of the
 * currently selected counter. The full counter records come from `useCounters`
 * (the query cache).
 *
 * No persistence middleware: the selection resets on reload, which is the
 * desired behavior for a shared serving station.
 */
import { create } from 'zustand';

/** Shape of the ephemeral counter-selection slice. */
export interface CounterSelectionState {
  /** The id of the counter the staff member has selected, or `null` if none. */
  activeCounterId: string | null;
  /** Select a counter (or clear the selection by passing `null`). */
  setActiveCounterId: (counterId: string | null) => void;
  /** Clear the current selection. */
  clear: () => void;
}

/**
 * Ephemeral store holding only the selected counter id. Created with plain
 * `create` (no persistence) so it never touches web storage and resets per
 * session.
 */
export const useCounterSelectionStore = create<CounterSelectionState>((set) => ({
  activeCounterId: null,
  setActiveCounterId: (counterId) => set({ activeCounterId: counterId }),
  clear: () => set({ activeCounterId: null }),
}));
