/*
 * InviteStaffForm — invite a staff member (R10.3, R10.5).
 *
 * Validation uses the shared `inviteStaffSchema` via the zod resolver (no
 * client-side re-definition of the rules), submit is disabled while pending, and
 * the backend contract is handled by `useInviteStaff`:
 * - on success: a toast + the list is invalidated by the hook, and the form
 *   resets so the next invite starts clean (R10.4);
 * - on failure: `error.details` map onto the matching fields and any non-field
 *   error becomes a toast (R10.5).
 *
 * The role select is limited to the roles `inviteStaffSchema` permits
 * (`ADMIN` / `STAFF`) — an org can only ever have one OWNER.
 */
import { useId, type ReactElement } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import {
	inviteStaffSchema,
	type InviteStaffInput,
} from "@queuenow/shared-validation";

import { applyFieldErrors } from "@/features/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/error-map";
import { strings } from "@/i18n";
import { cn } from "@/lib/utils";

import { useInviteStaff } from "../api/useInviteStaff";

/** Form fields eligible for backend inline error mapping. */
const INVITE_FIELDS: readonly Path<InviteStaffInput>[] = [
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
	const emailId = useId();
	const emailErrorId = useId();
	const roleId = useId();

	const inviteMutation = useInviteStaff({ orgId, page });

	const {
		register,
		handleSubmit,
		setError,
		reset,
		formState: { errors },
	} = useForm<InviteStaffInput>({
		resolver: zodResolver(inviteStaffSchema),
		defaultValues: { email: "", role: "STAFF" },
	});

	const onSubmit = handleSubmit((values) => {
		inviteMutation.mutate(values, {
			onSuccess: () => {
				toast.success(copy.success);
				reset({ email: "", role: "STAFF" });
			},
			onError: (error) => {
				const { mapped } = applyFieldErrors<InviteStaffInput>(
					error.details,
					INVITE_FIELDS,
					setError,
				);
				if (mapped.length === 0) {
					toast.error(getErrorMessage(error));
				}
			},
		});
	});

	const isPending = inviteMutation.isPending;

	return (
		<form
			noValidate
			onSubmit={onSubmit}
			className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:items-end"
		>
			<div className="flex-1 space-y-2">
				<Label htmlFor={emailId}>{copy.emailLabel}</Label>
				<Input
					id={emailId}
					type="email"
					autoComplete="email"
					aria-invalid={errors.email !== undefined}
					aria-describedby={errors.email ? emailErrorId : undefined}
					{...register("email")}
				/>
				{errors.email ? (
					<p id={emailErrorId} className="text-sm text-destructive">
						{errors.email.message}
					</p>
				) : null}
			</div>

			<div className="space-y-2">
				<Label htmlFor={roleId}>{copy.roleLabel}</Label>
				<select
					id={roleId}
					className={cn(
						"flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-40",
					)}
					{...register("role")}
				>
					{INVITE_ROLE_OPTIONS.map((value) => (
						<option key={value} value={value}>
							{strings.staff.roles[value]}
						</option>
					))}
				</select>
			</div>

			<Button type="submit" disabled={isPending}>
				{isPending ? copy.pending : copy.submit}
			</Button>
		</form>
	);
}
