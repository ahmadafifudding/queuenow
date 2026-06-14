import { Stack } from "expo-router";

import { Placeholder } from "@/components/Placeholder";

export default function NotFoundScreen(): React.JSX.Element {
	return (
		<>
			<Stack.Screen options={{ title: "Not found" }} />
			<Placeholder title="Not found" subtitle="This screen does not exist." />
		</>
	);
}
