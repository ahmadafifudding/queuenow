import {
	StyleSheet,
	Text,
	TextInput,
	View,
	type TextInputProps,
} from "react-native";

/**
 * Props for {@link FormField}: a labeled, controlled text input with an optional
 * inline error message. Extends `TextInputProps` so callers pass `value`,
 * `onChangeText`, `secureTextEntry`, keyboard hints, etc. directly.
 */
export interface FormFieldProps extends TextInputProps {
	/** Visible label shown above the input (also used as the accessibility label). */
	label: string;
	/** Inline error message shown beneath the input when present. */
	error?: string;
}

/**
 * A single labeled form field with an inline error, used by the auth forms. The
 * input border reflects the error state and the message is announced as an
 * alert, so validation feedback shows inline (not just in a toast) per the
 * forms-and-validation conventions.
 */
export function FormField({
	label,
	error,
	style,
	...inputProps
}: FormFieldProps): React.JSX.Element {
	return (
		<View style={styles.field}>
			<Text style={styles.label}>{label}</Text>
			<TextInput
				accessibilityLabel={label}
				placeholderTextColor="#94a3b8"
				style={[styles.input, error ? styles.inputError : null, style]}
				{...inputProps}
			/>
			{error ? (
				<Text
					accessibilityRole="alert"
					accessibilityLiveRegion="assertive"
					style={styles.errorText}
				>
					{error}
				</Text>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	field: {
		gap: 8,
	},
	label: {
		fontSize: 14,
		fontWeight: "600",
	},
	input: {
		borderWidth: 1,
		borderColor: "#cbd5e1",
		borderRadius: 8,
		paddingHorizontal: 14,
		paddingVertical: 12,
		fontSize: 16,
	},
	inputError: {
		borderColor: "#dc2626",
	},
	errorText: {
		fontSize: 13,
		color: "#dc2626",
	},
});
