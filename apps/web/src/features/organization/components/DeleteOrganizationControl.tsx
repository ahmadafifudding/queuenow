/**
 * DeleteOrganizationControl — OWNER-only org deletion (R11.7).
 *
 * Visibility is gated through `<RoleGate roles={[OWNER]}>` (equivalently the
 * `delete-organization` capability) so only an OWNER ever sees the control; the
 * backend remains the security boundary. To guard against accidental deletion,
 * the destructive action is revealed behind a confirm step that requires typing
 * the organization name before the delete mutation can run.
 */
import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { UserRoleType } from "@queuenow/shared-types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RoleGate } from "@/features/auth";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";

import { useDeleteOrganization } from "../api/useDeleteOrganization";

export interface DeleteOrganizationControlProps {
	/** The organization that may be deleted. */
	orgId: string;
	/** The organization's name; must be typed to confirm deletion. */
	organizationName: string;
}

export function DeleteOrganizationControl({
	orgId,
	organizationName,
}: DeleteOrganizationControlProps): ReactElement {
	const copy = strings.organization.danger;
	const remove = useDeleteOrganization(orgId);
	const [confirming, setConfirming] = useState(false);
	const [confirmText, setConfirmText] = useState("");

	const canConfirm =
		confirmText.trim() === organizationName.trim() &&
		organizationName.trim() !== "";

	const handleDelete = (): void => {
		remove.mutate(undefined, {
			onSuccess: () => {
				toast.success(copy.deleted);
				setConfirming(false);
				setConfirmText("");
			},
			onError: (error) => {
				toast.error(getErrorMessage(error));
			},
		});
	};

	return (
		<RoleGate roles={[UserRoleType.OWNER]}>
			<section className="rounded-lg border border-destructive/50 bg-destructive/5 p-6">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold tracking-tight text-destructive">
						{copy.title}
					</h2>
					<p className="text-sm text-muted-foreground">{copy.description}</p>
				</div>

				{confirming ? (
					<div className="mt-4 space-y-3">
						<Label htmlFor="delete-confirm">{copy.confirmPrompt}</Label>
						<Input
							id="delete-confirm"
							value={confirmText}
							placeholder={copy.confirmPlaceholder}
							autoComplete="off"
							onChange={(event) => setConfirmText(event.target.value)}
						/>
						<div className="flex gap-3">
							<Button
								type="button"
								variant="destructive"
								disabled={!canConfirm || remove.isPending}
								onClick={handleDelete}
							>
								{remove.isPending ? copy.deletePending : copy.confirm}
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={remove.isPending}
								onClick={() => {
									setConfirming(false);
									setConfirmText("");
								}}
							>
								{copy.cancel}
							</Button>
						</div>
					</div>
				) : (
					<div className="mt-4">
						<Button
							type="button"
							variant="destructive"
							onClick={() => setConfirming(true)}
						>
							{copy.deleteButton}
						</Button>
					</div>
				)}
			</section>
		</RoleGate>
	);
}
