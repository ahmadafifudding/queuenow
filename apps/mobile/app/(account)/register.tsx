import { RegisterForm } from "@/features/auth";

// Customer register (R6.1). Thin route: delegates to the auth feature component.
export default function RegisterScreen(): React.JSX.Element {
	return <RegisterForm />;
}
