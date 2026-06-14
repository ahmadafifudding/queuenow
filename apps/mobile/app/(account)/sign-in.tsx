import { SignInForm } from "@/features/auth";

// Customer sign-in (R6.2). Thin route: delegates to the auth feature component.
export default function SignInScreen(): React.JSX.Element {
	return <SignInForm />;
}
