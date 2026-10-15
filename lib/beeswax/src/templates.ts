/** Portable owned section; local executable bindings live in Git metadata. */
export const hookSection = [
	"# beeswax:begin tracker-validation v1",
	'"$(git rev-parse --git-path beeswax/cli)" hooks validate || exit $?',
	"# beeswax:end tracker-validation",
].join("\n");
