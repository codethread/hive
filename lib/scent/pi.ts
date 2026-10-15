import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installPiIdentity } from "./src/pi.ts";

// Pi's extension loader requires a default factory export.
export default function scent(pi: ExtensionAPI): void {
	installPiIdentity(pi, process.env);
}
