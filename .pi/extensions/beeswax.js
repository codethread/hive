/* eslint-disable capitalized-comments, import/no-anonymous-default-export, func-names */
/* eslint-disable curly, no-magic-numbers */
/* eslint-disable import/newline-after-import, import/no-nodejs-modules */
// beeswax:begin onboarding v3
import { fileURLToPath } from "node:url";
export default async function (pi) {
	const root = fileURLToPath(new URL("../../", import.meta.url));
	const checked = await pi.exec("beeswax", ["system", "pi-check", "--repo", root, "--json"]);
	if (checked.code !== 0) throw new Error(`Beeswax Pi prerequisite failed: ${checked.stderr || checked.stdout}. Run beeswax sync with the accepted release before loading Pi.`);
	const identity = JSON.parse(checked.stdout);
	const payload = await import(`../../.hive/beeswax/generated/pi-beeswax.js?${identity.payloadDigest}`);
	return payload.default(pi);
}
// beeswax:end onboarding
