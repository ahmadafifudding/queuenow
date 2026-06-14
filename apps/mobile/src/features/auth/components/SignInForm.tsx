import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { loginSchema, type LoginInput } from "@queuenow/shared-validation";

import { strings } from "@/i18n";
import { messageForErrorCode } from "@/lib/api/error-map";

import { firstFieldMessages, mapBackendFieldErrors } from "../lib/field-errors";
import { useLogin } from "../hooks/use-login";
import { FormField } from "./FormField";
import { SubmitButton } from "./SubmitButton";

/** Form fields eligible for inline (schema + backend) error mapping. */
type LoginField = keyof LoginInput;
const LOGIN_FIELDS: readonly LoginField[] = ["email", "password"];

/**
 * SignInForm — email/password sign-in (R6.2, R6.3, R6.10).
 *
 * - Validation uses the shared `loginSchema` (never redefined locally) before
 *   the request is sent; invalid input shows inline field errors and never
 *   reaches the network.
 * - Submit is disabled while the login mutation is pending.
 * - On invalid credentials the `authManager` stored no token (R6.3); we map the
 *   `ApiError` to friendly copy via `messageForErrorCode` and show it. Backend
 *   field errors from `error.details` are mapped onto the matching fields where
 *   possible; otherwise a general message is shown.
 * - On success we navigate to the account history view.
 */
export function SignInForm(): React.JSX.Element {
	const router = useRouter();
	const login = useLogin();

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [fieldErrors, setFieldErrors] = useState<
		Partial<Record<LoginField, string>>
	>({});
	const [generalError, setGeneralError] = useState<string | null>(null);

	const onSubmit = (): void => {
		setGeneralError(null);

		// R6.10: validate with the shared schema before sending.
		const parsed = loginSchema.safeParse({ email: email.trim(), password });
		if (!parsed.success) {
			setFieldErrors(
				firstFieldMessages<LoginField>(parsed.error.flatten().fieldErrors),
			);
			return;
		}
		setFieldErrors({});

		login.mutate(parsed.data, {
			onSuccess: () => {
				router.replace("/(account)/history");
			},
			onError: (error) => {
				const { fieldErrors: mappedFields, mapped } =
					mapBackendFieldErrors<LoginField>(error.details, LOGIN_FIELDS);
				if (mapped.length > 0) {
					setFieldErrors(mappedFields);
				} else {
					// Invalid credentials / other backend errors → friendly copy by code.
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
				<Text style={styles.title}>{strings.auth.signInTitle}</Text>
				<Text style={styles.subtitle}>{strings.auth.signInSubtitle}</Text>
			</View>

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
				label={strings.auth.fields.password}
				value={password}
				onChangeText={setPassword}
				error={fieldErrors.password}
				secureTextEntry
				autoCapitalize="none"
				textContentType="password"
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
				label={strings.auth.signInSubmit}
				pendingLabel={strings.auth.signInPending}
				isPending={login.isPending}
				onPress={onSubmit}
			/>

			<View style={styles.footer}>
				<Text style={styles.footerText}>{strings.auth.noAccountPrompt}</Text>
				<Pressable
					accessibilityRole="link"
					onPress={() => router.replace("/(account)/register")}
				>
					<Text style={styles.footerLink}>{strings.auth.registerLink}</Text>
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
