import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
	customerRegisterSchema,
	type CustomerRegisterInput,
} from "@queuenow/shared-validation";

import { strings } from "@/i18n";
import { messageForErrorCode } from "@/lib/api/error-map";

import { firstFieldMessages, mapBackendFieldErrors } from "../lib/field-errors";
import { useRegister } from "../hooks/use-register";
import { FormField } from "./FormField";
import { SubmitButton } from "./SubmitButton";

/** Form fields eligible for inline (schema + backend) error mapping. */
type RegisterField = keyof CustomerRegisterInput;
const REGISTER_FIELDS: readonly RegisterField[] = [
	"fullName",
	"email",
	"phone",
	"password",
];

/**
 * RegisterForm — customer account sign-up (R6.1, R6.3, R6.10).
 *
 * Mirrors {@link SignInForm}: validation uses the shared `customerRegisterSchema`
 * (never redefined), submit is disabled while pending, backend `error.details`
 * map onto fields, and on success we navigate to the account history view.
 *
 * Per the shared schema only `password` is required; `fullName`/`email`/`phone`
 * are optional. Empty optional inputs are dropped before validation so they are
 * treated as "omitted" (`undefined`) rather than failing the optional string
 * checks (e.g. an empty email is not a valid email).
 */
export function RegisterForm(): React.JSX.Element {
	const router = useRouter();
	const registerMutation = useRegister();

	const [fullName, setFullName] = useState("");
	const [email, setEmail] = useState("");
	const [phone, setPhone] = useState("");
	const [password, setPassword] = useState("");
	const [fieldErrors, setFieldErrors] = useState<
		Partial<Record<RegisterField, string>>
	>({});
	const [generalError, setGeneralError] = useState<string | null>(null);

	const onSubmit = (): void => {
		setGeneralError(null);

		// Drop empty optional fields so they are treated as omitted, not invalid.
		const input: CustomerRegisterInput = {
			password,
			...(fullName.trim() ? { fullName: fullName.trim() } : {}),
			...(email.trim() ? { email: email.trim() } : {}),
			...(phone.trim() ? { phone: phone.trim() } : {}),
		};

		// R6.10: validate with the shared schema before sending.
		const parsed = customerRegisterSchema.safeParse(input);
		if (!parsed.success) {
			setFieldErrors(
				firstFieldMessages<RegisterField>(parsed.error.flatten().fieldErrors),
			);
			return;
		}
		setFieldErrors({});

		registerMutation.mutate(parsed.data, {
			onSuccess: () => {
				router.replace("/(account)/history");
			},
			onError: (error) => {
				const { fieldErrors: mappedFields, mapped } =
					mapBackendFieldErrors<RegisterField>(error.details, REGISTER_FIELDS);
				if (mapped.length > 0) {
					setFieldErrors(mappedFields);
				} else {
					setGeneralError(messageForErrorCode(error.code));
				}
			},
		});
	};

	return (
		<ScrollView
			contentContainerStyle={styles.container}
			keyboardShouldPersistTaps="handled"
		>
			<View style={styles.header}>
				<Text style={styles.title}>{strings.auth.registerTitle}</Text>
				<Text style={styles.subtitle}>{strings.auth.registerSubtitle}</Text>
			</View>

			<FormField
				label={strings.auth.fields.fullName}
				value={fullName}
				onChangeText={setFullName}
				error={fieldErrors.fullName}
				autoCapitalize="words"
				textContentType="name"
				returnKeyType="next"
			/>

			<FormField
				label={strings.auth.fields.email}
				value={email}
				onChangeText={setEmail}
				error={fieldErrors.email}
				autoCapitalize="none"
				autoCorrect={false}
				keyboardType="email-address"
				textContentType="emailAddress"
				returnKeyType="next"
			/>

			<FormField
				label={strings.auth.fields.phone}
				value={phone}
				onChangeText={setPhone}
				error={fieldErrors.phone}
				autoCapitalize="none"
				autoCorrect={false}
				keyboardType="phone-pad"
				textContentType="telephoneNumber"
				returnKeyType="next"
			/>

			<FormField
				label={strings.auth.fields.password}
				value={password}
				onChangeText={setPassword}
				error={fieldErrors.password}
				secureTextEntry
				autoCapitalize="none"
				textContentType="newPassword"
				returnKeyType="go"
				onSubmitEditing={onSubmit}
			/>

			{generalError ? (
				<Text
					accessibilityRole="alert"
					accessibilityLiveRegion="assertive"
					style={styles.generalError}
				>
					{generalError}
				</Text>
			) : null}

			<SubmitButton
				label={strings.auth.registerSubmit}
				pendingLabel={strings.auth.registerPending}
				isPending={registerMutation.isPending}
				onPress={onSubmit}
			/>

			<View style={styles.footer}>
				<Text style={styles.footerText}>{strings.auth.hasAccountPrompt}</Text>
				<Pressable
					accessibilityRole="link"
					onPress={() => router.replace("/(account)/sign-in")}
				>
					<Text style={styles.footerLink}>{strings.auth.signInLink}</Text>
				</Pressable>
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	container: {
		flexGrow: 1,
		padding: 24,
		gap: 20,
	},
	header: {
		gap: 8,
	},
	title: {
		fontSize: 24,
		fontWeight: "700",
	},
	subtitle: {
		fontSize: 15,
		opacity: 0.7,
	},
	generalError: {
		fontSize: 14,
		color: "#dc2626",
	},
	footer: {
		flexDirection: "row",
		justifyContent: "center",
		gap: 6,
	},
	footerText: {
		fontSize: 14,
		opacity: 0.7,
	},
	footerLink: {
		fontSize: 14,
		color: "#2563eb",
		fontWeight: "600",
	},
});
