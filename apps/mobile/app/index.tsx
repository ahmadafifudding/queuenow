import { DiscoveryHome } from "@/features/discovery";

// Home / discovery entry (manual code + favorites shortcut). See R1.2.
// Thin route: delegates to the discovery feature component.
export default function HomeScreen(): React.JSX.Element {
	return <DiscoveryHome />;
}
