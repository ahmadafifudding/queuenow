/**
 * PlanChangeDialog — OWNER-only manual plan-change picker (R6, R8.4, R9.4).
 *
 * The interim upgrade path before Stripe billing: an OWNER picks a target plan
 * and confirms; the change is sent through `useChangePlan` (PATCH
 * `/organizations/:id/plan`). The backend is the authoritative boundary — this
 * dialog is gated to the `manage-billing` capability (OWNER-only per the
 * capability matrix) purely so the UI never offers an action the role can't
 * perform; a non-OWNER renders nothing.
 *
 * It is a controlled component: the parent (`PlanUsageView`) owns `open` so both
 * the header "Change plan" button and a per-resource at-limit upgrade prompt can
 * drive the same dialog. The picker is a native `<select>` (fully accessible, no
 * extra primitive dependency) and the modal is a minimal, self-contained,
 * accessible dialog (role="dialog" + aria-modal, Escape to close, focus moved in
 * on open) consistent with the app's hand-rolled shadcn-style primitives.
 *
 * On a plan-limit rejection it reuses the shared `onPlanLimitError` helper; any
 * other failure surfaces a code-mapped toast. The current selection is retained
 * on error so the user can retry.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { PlanType } from "@queuenow/shared-types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useHasCapability } from "@/features/auth";
import { getErrorMessage } from "@/lib/api/error-map";
import { cn } from "@/lib/utils";
import { strings } from "@/i18n";

import { useChangePlan } from "../api/useChangePlan";
import { onPlanLimitError } from "../lib/plan-limit-error";
import { showUpgradePrompt } from "../lib/upgrade-prompt";

/** Props for {@link PlanChangeDialog}. */
export interface PlanChangeDialogProps {
	/** The organization whose plan may change. */
	orgId: string;
	/** The organization's current plan (pre-selected in the picker). */
	currentPlan: PlanType;
	/** Whether the dialog is open (controlled by the parent). */
	open: boolean;
	/** Request to open/close the dialog. */
	onOpenChange: (open: boolean) => void;
}

/** All selectable plan tiers, in tier order. */
const PLAN_OPTIONS: readonly PlanType[] = [
	PlanType.FREE,
	PlanType.BASIC,
	PlanType.PRO,
	PlanType.ENTERPRISE,
];

export function PlanChangeDialog({
	orgId,
	currentPlan,
	open,
	onOpenChange,
}: PlanChangeDialogProps): ReactElement | null {
	const copy = strings.plan.changeDialog;
	const planNames = strings.plan.planNames;
	const canManageBilling = useHasCapability("manage-billing");

	const changePlan = useChangePlan(orgId);
	const [selectedPlan, setSelectedPlan] = useState<PlanType>(currentPlan);

	const titleId = useId();
	const descriptionId = useId();
	const selectId = useId();
	const dialogRef = useRef<HTMLDivElement>(null);

	// Reset the selection to the current plan whenever the dialog (re)opens so it
	// never shows a stale choice from a previous session, and move focus into the
	// dialog for keyboard users.
	useEffect(() => {
		if (open) {
			setSelectedPlan(currentPlan);
			dialogRef.current?.focus();
		}
	}, [open, currentPlan]);

	// Escape closes the dialog (standard dialog affordance).
	useEffect(() => {
		if (!open) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				onOpenChange(false);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, onOpenChange]);

	// OWNER-only (capability matrix → manage-billing). Non-OWNER sees nothing.
	if (!canManageBilling) {
		return null;
	}

	if (!open) {
		return null;
	}

	const handleSubmit = (): void => {
		changePlan.mutate(
			{ plan: selectedPlan },
			{
				onSuccess: () => {
					toast.success(copy.success);
					onOpenChange(false);
				},
				onError: (error) => {
					// A plan-limit rejection (rare for a plan change) reuses the shared
					// upgrade-prompt helper; anything else is a code-mapped toast. The
					// selection is intentionally retained either way so the user can retry.
					const handled = onPlanLimitError(error, showUpgradePrompt());
					if (!handled) {
						toast.error(getErrorMessage(error));
					}
				},
			},
		);
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-4"
			role="presentation"
		>
			{/* Backdrop — clicking outside closes the dialog. */}
			<button
				type="button"
				aria-label={copy.close}
				tabIndex={-1}
				className="absolute inset-0 bg-black/50"
				onClick={() => onOpenChange(false)}
			/>

			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				tabIndex={-1}
				className="relative z-10 w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg focus:outline-none"
			>
				<div className="space-y-1">
					<h2 id={titleId} className="text-lg font-semibold tracking-tight">
						{copy.title}
					</h2>
					<p id={descriptionId} className="text-sm text-muted-foreground">
						{copy.description}
					</p>
				</div>

				<div className="mt-4 space-y-2">
					<Label htmlFor={selectId}>{copy.planLabel}</Label>
					<select
						id={selectId}
						value={selectedPlan}
						disabled={changePlan.isPending}
						onChange={(event) =>
							setSelectedPlan(event.target.value as PlanType)
						}
						className={cn(
							"flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
							"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
							"disabled:cursor-not-allowed disabled:opacity-50",
						)}
					>
						{PLAN_OPTIONS.map((plan) => (
							<option key={plan} value={plan}>
								{planNames[plan]}
								{plan === currentPlan ? ` ${copy.currentSuffix}` : ""}
							</option>
						))}
					</select>
				</div>

				<div className="mt-6 flex justify-end gap-3">
					<Button
						type="button"
						variant="outline"
						disabled={changePlan.isPending}
						onClick={() => onOpenChange(false)}
					>
						{copy.cancel}
					</Button>
					<Button
						type="button"
						disabled={changePlan.isPending}
						onClick={handleSubmit}
					>
						{changePlan.isPending ? copy.submitPending : copy.submit}
					</Button>
				</div>
			</div>
		</div>
	);
}
