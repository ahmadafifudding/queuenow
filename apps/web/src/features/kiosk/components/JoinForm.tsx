/*
 * JoinForm — the confirm step where the customer provides any required details
 * and joins the queue (R12.3, R12.4, R12.6).
 *
 * The collected fields are GATED by the org's queue settings: the name field is
 * shown/required only when `requireName` is set, and the phone only when
 * `requirePhone` is set (R12.3). Validation uses the shared `joinQueueSchema`
 * tightened by `buildKioskJoinSchema(settings)` — the Kiosk never redefines the
 * base rules, it only enforces the required fields the settings demand.
 *
 * When neither field is required, this becomes a simple confirm screen showing
 * the chosen service plus a large "join" button (R12.8 touch target).
 */
import { useMemo, type ReactElement } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { JoinQueueInput } from "@queuenow/shared-validation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { strings } from "@/i18n";

import {
	buildKioskJoinSchema,
	kioskRequiredFields,
} from "../lib/required-fields";
import type { KioskQueueSettings, KioskService } from "../types";

/** Props for {@link JoinForm}. */
export interface JoinFormProps {
	/** The service the customer chose (its id seeds the join payload). */
	service: KioskService;
	/** The queue settings that drive required-field gating. */
	settings: KioskQueueSettings;
	/** Submit handler invoked with the validated join payload (R12.4). */
	onSubmit: (values: JoinQueueInput) => void;
	/** Whether the join request is in flight (disables submit). */
	isPending: boolean;
	/** True when the last join attempt failed because the queue is full (R12.6). */
	isQueueFull: boolean;
	/** Return to the service-selection screen. */
	onBack: () => void;
}

/**
 * The details / confirm step of the Kiosk flow.
 *
 * @param props - the chosen service, settings, and submit/back callbacks.
 */
export function JoinForm({
	service,
	settings,
	onSubmit,
	isPending,
	isQueueFull,
	onBack,
}: JoinFormProps): ReactElement {
	const required = kioskRequiredFields(settings);
	const schema = useMemo(() => buildKioskJoinSchema(settings), [settings]);

	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<JoinQueueInput>({
		resolver: zodResolver(schema),
		defaultValues: {
			serviceId: service.id,
			customerName: "",
			customerPhone: "",
		},
	});

	const submit = handleSubmit((values) => {
		onSubmit(values);
	});

	return (
		<section
			className="flex w-full max-w-lg flex-col gap-8"
			aria-labelledby="kiosk-details-heading"
		>
			<header className="text-center">
				<h2
					id="kiosk-details-heading"
					className="text-3xl font-bold sm:text-4xl"
				>
					{strings.kiosk.detailsTitle}
				</h2>
				<p className="mt-2 text-lg text-muted-foreground">
					{strings.kiosk.detailsSubtitle}
				</p>
			</header>

			<div className="flex items-center justify-center gap-3 rounded-2xl border-2 border-border bg-card p-5 text-center">
				<span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-xl font-black text-primary-foreground">
					{service.prefix}
				</span>
				<span className="text-left">
					<span className="block text-sm uppercase tracking-wide text-muted-foreground">
						{strings.kiosk.selectedServiceLabel}
					</span>
					<span className="block text-2xl font-semibold">{service.name}</span>
				</span>
			</div>

			{isQueueFull ? (
				<div
					role="alert"
					className="flex flex-col items-center gap-2 rounded-2xl border-2 border-destructive/50 bg-destructive/5 p-6 text-center"
				>
					<p className="text-xl font-bold text-destructive">
						{strings.kiosk.queueFullTitle}
					</p>
					<p className="text-base text-muted-foreground">
						{strings.kiosk.queueFullBody}
					</p>
				</div>
			) : null}

			<form noValidate onSubmit={submit} className="flex flex-col gap-6">
				{/* serviceId is carried in the form state but never edited by the user. */}
				<input type="hidden" {...register("serviceId")} />

				{required.name ? (
					<div className="space-y-2">
						<Label htmlFor="kiosk-name" className="text-lg">
							{strings.kiosk.fields.name}
						</Label>
						<Input
							id="kiosk-name"
							autoComplete="name"
							inputMode="text"
							placeholder={strings.kiosk.fields.namePlaceholder}
							className="h-14 text-lg"
							aria-invalid={errors.customerName !== undefined}
							aria-describedby={
								errors.customerName ? "kiosk-name-error" : undefined
							}
							{...register("customerName")}
						/>
						{errors.customerName ? (
							<p id="kiosk-name-error" className="text-base text-destructive">
								{errors.customerName.message}
							</p>
						) : null}
					</div>
				) : null}

				{required.phone ? (
					<div className="space-y-2">
						<Label htmlFor="kiosk-phone" className="text-lg">
							{strings.kiosk.fields.phone}
						</Label>
						<Input
							id="kiosk-phone"
							type="tel"
							autoComplete="tel"
							inputMode="tel"
							placeholder={strings.kiosk.fields.phonePlaceholder}
							className="h-14 text-lg"
							aria-invalid={errors.customerPhone !== undefined}
							aria-describedby={
								errors.customerPhone ? "kiosk-phone-error" : undefined
							}
							{...register("customerPhone")}
						/>
						{errors.customerPhone ? (
							<p id="kiosk-phone-error" className="text-base text-destructive">
								{errors.customerPhone.message}
							</p>
						) : null}
					</div>
				) : null}

				<div className="flex flex-col gap-3 sm:flex-row-reverse">
					<Button
						type="submit"
						size="lg"
						className="h-14 flex-1 text-lg"
						disabled={isPending}
					>
						{isPending ? strings.kiosk.confirmPending : strings.kiosk.confirm}
					</Button>
					<Button
						type="button"
						size="lg"
						variant="outline"
						className="h-14 flex-1 text-lg"
						onClick={onBack}
						disabled={isPending}
					>
						{strings.kiosk.back}
					</Button>
				</div>
			</form>
		</section>
	);
}
