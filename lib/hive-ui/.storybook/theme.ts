import { create, themes } from "storybook/theming";

// Storybook's built-in dark theme keeps the preview background white.
export const workshopTheme = create({
	base: "dark",
	appPreviewBg: themes.dark.appBg,
});
