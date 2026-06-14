import { QrScanner } from "@/features/discovery";

// QR scanner (expo-camera) → parseDiscoveryUrl → navigate to join. See R1.1, R1.3.
// Thin route: delegates to the discovery feature component.
export default function ScanScreen(): React.JSX.Element {
	return <QrScanner />;
}
