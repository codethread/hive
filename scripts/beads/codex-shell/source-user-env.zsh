# Preserve user startup, then restore the project selection for nested shells.
() {
	local hive_startup_file=$1
	local hive_adapter_dir=$ZDOTDIR
	export ZDOTDIR=$HIVE_CODEX_USER_ZDOTDIR
	if [[ -f "$ZDOTDIR/$hive_startup_file" ]]; then
		source "$ZDOTDIR/$hive_startup_file"
	fi
	export HIVE_CODEX_USER_ZDOTDIR=$ZDOTDIR
	export ZDOTDIR=$hive_adapter_dir
	export PATH="${BEADS_DB:h:h}/scripts/beads/bin:$PATH"
} "$1"
