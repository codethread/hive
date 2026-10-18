/** Portable owned section; local executable bindings live in Git metadata. */
export const hookSection = [
	"# beeswax:begin tracker-validation v2",
	'"$(git rev-parse --git-path beeswax/cli)" system hooks validate || exit $?',
	"# beeswax:end tracker-validation",
].join("\n");

/** Recognized v1 section for upgrading owned hooks. */
export const previousHookSection = [
	"# beeswax:begin tracker-validation v1",
	'"$(git rev-parse --git-path beeswax/cli)" hooks validate || exit $?',
	"# beeswax:end tracker-validation",
].join("\n");
