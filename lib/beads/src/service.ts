/* eslint-disable max-params -- Native dep/query methods keep explicit scope, identifiers and options together. */
import type { Bead, BeadComment } from "./model.ts";

export interface BeadsService {
	create: (scope: BeadsScope, input: CreateBead) => Promise<CreatedBead>;
	show: (scope: BeadsScope, id: string) => Promise<BeadRecord>;
	showMany: (scope: BeadsScope, ids: readonly string[]) => Promise<BeadRecord[]>;
	list: (scope: BeadsScope, selection?: BeadSelection) => Promise<BeadPage>;
	search: (scope: BeadsScope, text: string, selection?: BeadSelection) => Promise<BeadSearchPage>;
	ready: (scope: BeadsScope, selection?: ReadySelection) => Promise<ReadyBead[]>;
	update: (
		scope: BeadsScope,
		ids: readonly string[],
		input: UpdateBead,
	) => Promise<BeadUpdateReceipt[]>;
	close: (
		scope: BeadsScope,
		id: string,
		input?: { reason?: string | undefined; force?: boolean | undefined },
	) => Promise<BeadCloseReceipt[]>;
	where: (scope: BeadsScope) => Promise<BeadsLocation>;
	comments: {
		add: (scope: BeadsScope, id: string, text: string) => Promise<BeadComment>;
		list: (scope: BeadsScope, id: string) => Promise<BeadComment[]>;
	};
	dep: {
		add: (
			scope: BeadsScope,
			id: string,
			dependsOn: string,
			type?: string,
		) => Promise<DependencyReceipt>;
		remove: (
			scope: BeadsScope,
			id: string,
			dependsOn: string,
			type?: string,
		) => Promise<DependencyReceipt>;
	};
	query: {
		save: (
			scope: BeadsScope,
			name: string,
			selection: BeadSelection,
			description?: string,
		) => Promise<QueryReceipt>;
		list: (scope: BeadsScope) => Promise<{ queries: SavedQuery[]; count: number }>;
		run: (scope: BeadsScope, name: string, overrides?: BeadSelection) => Promise<BeadPage>;
		delete: (scope: BeadsScope, name: string) => Promise<QueryReceipt>;
	};
	/** Filesystem synchronization stays at the live boundary; memory rejects these operations. */
	sync: {
		import: (scope: BeadsScope) => Promise<void>;
		flush: (scope: BeadsScope) => Promise<void>;
		merge: (scope: BeadsScope) => Promise<void>;
		/** Inspect without native auto-import or auto-flush side effects. */
		status: (scope: BeadsScope) => Promise<SyncStatus>;
	};
}

/** Execution checkout, tracker authority and audit identity are independent selections. */
export interface BeadsScope {
	cwd: string;
	noAutoImport?: boolean | undefined;
	noAutoFlush?: boolean | undefined;
	/** Absent preserves the native invocation environment and discovery. */
	db?: string | undefined;
	/** Absent preserves native attribution; explicit values override the environment. */
	actor?: string | undefined;
}
export interface BeadRelation {
	id: string;
	dependency_type: string;
	title: string;
	status: string;
	priority: number;
	issue_type?: string | undefined;
}
/** Unhydrated issue fields returned by create and selection operations. */
export interface BeadRow extends Omit<Bead, "dependencies" | "dependents" | "comments"> {
	title: string;
	issue_type: string;
	created_by?: string | undefined;
	notes: string;
	design: string;
	acceptance_criteria: string;
	defer_until?: string | undefined;
	due_at?: string | undefined;
}
export type CreatedBead = BeadRow;
/** Hydrated detail returned only by show/showMany. */
export interface BeadRecord extends BeadRow {
	dependencies: BeadRelation[];
	dependents: BeadRelation[];
	comments: BeadComment[];
}
/** Native ready --brief work-selection facts. */
export type ReadyBead = Pick<
	BeadRow,
	"id" | "title" | "issue_type" | "status" | "priority" | "created_at" | "updated_at" | "labels"
>;
export interface CreateBead {
	title: string;
	description?: string | undefined;
	type?: string | undefined;
	priority?: number | undefined;
	status?: string | undefined;
	owner?: string | undefined;
	assignee?: string | undefined;
	labels?: readonly string[] | undefined;
	parent?: string | undefined;
	deps?: readonly BeadDependency[] | undefined;
	notes?: string | undefined;
	design?: string | undefined;
	acceptanceCriteria?: string | undefined;
	defer?: string | undefined;
	due?: string | undefined;
}
export interface BeadDependency {
	id: string;
	type: string;
}
export interface UpdateBead extends Partial<Omit<CreateBead, "deps">> {
	claim?: boolean | undefined;
	force?: boolean | undefined;
	ifUnchanged?: string | undefined;
	setLabels?: readonly string[] | undefined;
	addLabels?: readonly string[] | undefined;
	removeLabels?: readonly string[] | undefined;
	appendNotes?: string | undefined;
}
export interface BeadSelection {
	status?: readonly string[] | undefined;
	type?: readonly string[] | undefined;
	priority?: readonly number[] | undefined;
	assignee?: string | undefined;
	ids?: readonly string[] | undefined;
	labels?: readonly string[] | undefined;
	labelAny?: readonly string[] | undefined;
	excludeLabels?: readonly string[] | undefined;
	unassigned?: boolean | undefined;
	all?: boolean | undefined;
	deferred?: boolean | undefined;
	titleContains?: string | undefined;
	descriptionContains?: string | undefined;
	notesContains?: string | undefined;
	limit?: number | undefined;
	offset?: number | undefined;
	sort?: "priority" | "created_at" | "updated_at" | "title" | undefined;
	reverse?: boolean | undefined;
}
export interface ReadySelection {
	assignee?: string | undefined;
	unassigned?: boolean | undefined;
	labels?: readonly string[] | undefined;
	labelAny?: readonly string[] | undefined;
	priority?: number | undefined;
	type?: string | undefined;
	parent?: string | undefined;
	includeDeferred?: boolean | undefined;
	limit?: number | undefined;
	sort?: "hybrid" | "priority" | "oldest" | undefined;
}
export interface BeadPage {
	issues: BeadRow[];
	total: number;
	limit: number;
	offset: number;
	has_more: boolean;
}
export interface BeadSearchPage extends Omit<BeadPage, "total"> {
	hidden_closed_count: number;
}
export interface BeadUpdateReceipt {
	id: string;
	title: string;
	status: string;
	priority: number;
	assignee: string | null;
	owner: string | null;
	updated_at: string;
}
export interface BeadCloseReceipt {
	id: string;
	title: string;
	status: string;
	closed_at: string;
	close_reason: string;
}
export interface DependencyReceipt {
	status: string;
	issue_id: string;
	depends_on_id: string;
	type: string;
	action: "added" | "already_exists" | "removed" | "not_found";
}
export interface SavedQuery {
	name: string;
	description?: string | undefined;
	created_at: string;
}
export interface QueryReceipt {
	status: string;
	name: string;
	action: "saved" | "deleted";
}
export interface BeadsLocation {
	database_path: string;
	beads_dir?: string | undefined;
}
export interface SyncStatus {
	coverage_drift: boolean;
	jsonl_exists: boolean;
	jsonl_newer: boolean;
	workspace_health: string;
}
