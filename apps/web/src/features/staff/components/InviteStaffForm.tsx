/*
 * InviteStaffForm — invite a staff member (R10.3, R10.5).
 *
 * Validation uses the shared `inviteStaffSchema` via TanStack Form's Standard
 * Schema validator (no client-side re-definition of the rules), submit is
 * disabled while submitting, and the backend contract is handled by
 * `useInviteStaff`:
 * - on success: a toast + the list is invalidated by the hook, and the form
 *   resets so the next invite starts clean (R10.4);
 * - on failure: `error.details` map onto the matching fields (returned from
 *   `onSubmitAsync`) and any non-field error becomes a toast (R10.5).
 *
 * The role select is limited to the roles `inviteStaffSchema` permits
 * (`ADMIN` / `STAFF`) — an org can only ever have one OWNER.
 */
import type { ReactElement } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import {
	inviteStaffSchema,
	type InviteStaffInput,
} from "@queuenow/shared-validation";

import { toFieldErrors } from "@/features/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/error-map";
import { firstErrorMessage, zodFormValidator } from "@/lib/forms";
import { strings } from "@/i18n";
import { cn } from "@/lib/utils";

import { useInviteStaff } from "../api/useInviteStaff";

/** Form fields eligible for backend inline error mapping. */
const INVITE_FIELDS: readonly (keyof InviteStaffInput)[] = [
	"email",
	"role",
	"serviceId",
];

/** Roles an invitee may be given (matches `inviteStaffSchema`). */
const INVITE_ROLE_OPTIONS: readonly InviteStaffInput["role"][] = [
	"ADMIN",
	"STAFF",
];

/** Props for {@link InviteStaffForm}. */
export interface InviteStaffFormProps {
	/** The organization to invite into. */
	orgId: string;
	/** The visible staff page, used to invalidate `['staff', orgId, page]`. */
	page: number;
}

/** The staff-invite form. */
export function InviteStaffForm({
	orgId,
	page,
}: InviteStaffFormProps): ReactElement {
	const copy = strings.staff.invite;

	const inviteMutation = useInviteStaff({ orgId, page });

	const form = useForm({
		defaultValues: { email: "", role: "STAFF" } as InviteStaffInput,
		validators: {
			onSubmit: zodFormValidator(inviteStaffSchema),
			onSubmitAsync: async ({ value }) => {
				try {
					await inviteMutation.mutateAsync(value);
					return null;
				} catch (error) {
					const apiError = error instanceof ApiError ? error : undefined;
					const { fields, mapped } = toFieldErrors(
						apiError?.details,
						INVITE_FIELDS as readonly string[],
					);
					if (mapped.length === 0) {
						const message = getErrorMessage(apiError);
						toast.error(message);
						return { form: message };
					}
					return { fields };
				}
			},
		},
		onSubmit: ({ formApi }) => {
			toast.success(copy.success);
			formApi.reset();
		},
	});

	return (
		<form
			noValidate
			className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:items-end"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="email">
				{(field) => {
					const error = firstErrorMessage(field.state.meta.errors);
					return (
						<div className="flex-1 space-y-2">
							<Label htmlFor={field.name}>{copy.emailLabel}</Label>
							<Input
								id={field.name}
								name={field.name}
								type="email"
								autoComplete="email"
								aria-invalid={error !== undefined}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
							{error ? (
								<p className="text-sm text-destructive">{error}</p>
							) : null}
						</div>
					);
				}}
			</form.Field>

			<form.Field name="role">
				{(field) => (
					<div className="space-y-2">
						<Label htmlFor={field.name}>{copy.roleLabel}</Label>
						<select
							id={field.name}
							name={field.name}
							className={cn(
								"flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-40",
							)}
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(event) =>
								field.handleChange(
									event.target.value as InviteStaffInput["role"],
								)
							}
						>
							{INVITE_ROLE_OPTIONS.map((value) => (
								<option key={value} value={value}>
									{strings.staff.roles[value]}
								</option>
							))}
						</select>
					</div>
				)}
			</form.Field>

			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" disabled={isSubmitting}>
						{isSubmitting ? copy.pending : copy.submit}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}
