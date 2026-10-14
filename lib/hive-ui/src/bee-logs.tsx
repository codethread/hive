import {
	Close as DialogClose,
	Content as DialogContent,
	Description as DialogDescription,
	Overlay as DialogOverlay,
	Portal as DialogPortal,
	Root as DialogRoot,
	Title as DialogTitle,
	Trigger as DialogTrigger,
} from "@radix-ui/react-dialog";
import { EMPTY, loadLogs, logs, preferences, snapshot } from "./data.ts";
import type { LogEntry, LogQuery } from "../log-contracts.ts";
import { logKey, logQuerySchema } from "../log-contracts.ts";
import { ResourceNotice } from "./ui.tsx";
import { useState } from "react";
import { useStore } from "zustand";

interface Selection {
	/** Configured colony identity, never a filesystem path. */
	colonyId: string;
	/** Only this request's retained evidence may be displayed. */
	requestId: string;
}
interface AttemptSelection extends Selection {
	/** Explicit retained attempt prevents paging across retries. */
	attempt: string;
}
interface StreamSelection extends AttemptSelection {
	/** Diagnostics remain separate from stdout events. */
	stream: LogQuery["stream"];
}

export function BeeLogs({ colonyId, requestId }: Selection) {
	const [attempt, setAttempt] = useState<string | undefined>();
	const query = logQuerySchema.parse({ attempt });
	const resource = useLogResource({ colonyId, requestId }, query);
	const data = snapshot(resource);
	return (
		<section aria-label="Bee log preview" className="mt-6 space-y-3 border-t border-line pt-5">
			<h3 className="font-medium">Bee log preview</h3>
			<p className="text-xs text-muted">Last five complete stdout entries, in source order.</p>
			<label className="block text-xs text-muted">
				Attempt
				<select
					className="control mt-2 w-full"
					value={attempt ?? ""}
					onChange={(event) => {
						const selected = event.target.value || undefined;
						setAttempt(selected);
						void loadLogs(colonyId, requestId, { attempt: selected });
					}}
				>
					<option value="">Current / latest attempt</option>
					{data?.attempts.map((entry) => (
						<option key={entry.id} value={entry.id}>
							Attempt {entry.number} · {entry.id} · {entry.harness} · {entry.state}
						</option>
					))}
				</select>
			</label>
			<ResourceNotice resource={resource} label="Logs" />
			{data?.attempt && (
				<p className="break-words text-xs text-muted">
					Attempt {data.attempt.number} · {data.attempt.id} · {data.attempt.state}
				</p>
			)}
			{data?.kind === "missing" && <p className="text-sm text-muted">{data.message}</p>}
			{data?.kind === "page" && (
				<>
					{data.entries.length === 0 && (
						<p className="text-sm text-muted">No complete stdout entries.</p>
					)}
					<ol className="space-y-3">
						{data.entries.map((entry) => (
							<li key={entry.offset} className="rounded-md border border-line p-3">
								<EntrySummary entry={entry} />
							</li>
						))}
					</ol>
					<TailNotice incomplete={data.incompleteTail} />
				</>
			)}
			<div className="flex flex-wrap gap-2">
				<button
					className="button"
					type="button"
					onClick={() => {
						void loadLogs(colonyId, requestId, query, true);
					}}
				>
					Refresh preview
				</button>
				{data?.attempt && (
					<LogDialog
						key={data.attempt.id}
						colonyId={colonyId}
						requestId={requestId}
						attempt={data.attempt.id}
					/>
				)}
			</div>
		</section>
	);
}

export function BeeLogTimeline({ colonyId, requestId, attempt }: AttemptSelection) {
	const [stream, setStream] = useState<LogQuery["stream"]>("stdout");
	const [revision, setRevision] = useState(0);
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<label className="text-sm">
					Stream
					<select
						className="control ml-2"
						value={stream}
						onChange={(event) => {
							const selected = logQuerySchema.shape.stream.parse(event.target.value);
							setStream(selected);
							void loadLogs(colonyId, requestId, { attempt, mode: "page", stream: selected });
						}}
					>
						<option value="stdout">stdout events</option>
						<option value="stderr">stderr diagnostics</option>
					</select>
				</label>
				<button
					className="button"
					type="button"
					onClick={() => {
						setRevision((value) => value + 1);
						void loadLogs(colonyId, requestId, { attempt, mode: "page", stream }, true);
					}}
				>
					Refresh timeline
				</button>
			</div>
			<p className="break-words text-xs text-muted">
				{requestId} · {attempt} · {stream} · Source order
			</p>
			<TimelinePages
				key={`${stream}/${revision}`}
				colonyId={colonyId}
				requestId={requestId}
				attempt={attempt}
				stream={stream}
			/>
		</div>
	);
}

// --- Explicit timeline, page and raw-detail actions ---
function LogDialog({ colonyId, requestId, attempt }: AttemptSelection) {
	const [open, setOpen] = useState(false);
	const theme = useStore(preferences, (state) => state.theme);
	return (
		<DialogRoot
			open={open}
			onOpenChange={(value) => {
				setOpen(value);
				if (value) {
					void loadLogs(colonyId, requestId, { attempt, mode: "page" });
				}
			}}
		>
			<DialogTrigger asChild>
				<button className="button" type="button">
					Open full timeline
				</button>
			</DialogTrigger>
			<DialogPortal>
				<DialogOverlay className="bee-log-overlay" />
				<DialogContent data-theme={theme} className="bee-log-dialog">
					<header className="flex items-center justify-between gap-3 border-b border-line p-5">
						<div>
							<DialogTitle className="font-semibold">Bee log timeline</DialogTitle>
							<DialogDescription className="mt-1 text-xs text-muted">
								Retained evidence. Load older-to-newer pages and complete details explicitly.
							</DialogDescription>
						</div>
						<DialogClose asChild>
							<button className="button" type="button">
								Close
							</button>
						</DialogClose>
					</header>
					<div className="min-h-0 overflow-y-auto overscroll-contain p-5">
						<BeeLogTimeline colonyId={colonyId} requestId={requestId} attempt={attempt} />
					</div>
				</DialogContent>
			</DialogPortal>
		</DialogRoot>
	);
}

function TimelinePages(selection: StreamSelection) {
	const [cursors, setCursors] = useState([0]);
	return (
		<div className="space-y-4">
			{cursors.map((cursor, index) => (
				<LogPage
					key={cursor}
					selection={selection}
					cursor={cursor}
					last={index === cursors.length - 1}
					onNext={(next) => {
						void loadLogs(selection.colonyId, selection.requestId, {
							attempt: selection.attempt,
							stream: selection.stream,
							mode: "page",
							cursor: next,
						});
						setCursors((current) => [...current, next]);
					}}
				/>
			))}
		</div>
	);
}

function LogPage({
	selection,
	cursor,
	last,
	onNext,
}: {
	selection: StreamSelection;
	cursor: number;
	last: boolean;
	onNext: (next: number) => void;
}) {
	const query = logQuerySchema.parse({
		attempt: selection.attempt,
		stream: selection.stream,
		mode: "page",
		cursor,
	});
	const resource = useLogResource(selection, query);
	const data = snapshot(resource);
	return (
		<div className="space-y-3">
			<ResourceNotice resource={resource} label="Timeline" />
			{data?.kind === "missing" && <p className="text-sm text-muted">{data.message}</p>}
			{data?.kind === "page" && (
				<>
					{data.entries.length === 0 && (
						<p className="text-sm text-muted">No complete {selection.stream} entries.</p>
					)}
					<ol className="space-y-3">
						{data.entries.map((entry) => (
							<li key={entry.offset} className="rounded-md border border-line bg-panel p-4">
								<EntrySummary entry={entry} />
								<RawDetails selection={selection} entry={entry} />
							</li>
						))}
					</ol>
					{last && <TailNotice incomplete={data.incompleteTail} />}
					{last && data.next !== null && (
						<button
							className="button"
							type="button"
							onClick={() => {
								onNext(data.next!);
							}}
						>
							Load next page
						</button>
					)}
					{last && data.next === null && (
						<p className="text-xs text-muted">
							End of complete entries. Refresh to read newly retained output.
						</p>
					)}
				</>
			)}
			{last && resource.kind === "failed" && (
				<button
					className="button"
					type="button"
					onClick={() => {
						void loadLogs(selection.colonyId, selection.requestId, query, true);
					}}
				>
					Retry page
				</button>
			)}
		</div>
	);
}

function RawDetails({ selection, entry }: { selection: StreamSelection; entry: LogEntry }) {
	const [expanded, setExpanded] = useState(false);
	const [cursors, setCursors] = useState([entry.offset]);
	const load = (cursor: number) =>
		loadLogs(
			selection.colonyId,
			selection.requestId,
			{
				attempt: selection.attempt,
				stream: selection.stream,
				mode: "raw",
				cursor,
				end: entry.end,
			},
			true,
		);
	return (
		<div className="mt-3">
			<button
				className="button"
				type="button"
				aria-expanded={expanded}
				onClick={() => {
					if (!expanded) {
						void load(entry.offset);
						setCursors([entry.offset]);
					}
					setExpanded(!expanded);
				}}
			>
				{expanded ? "Hide raw details" : "Show raw details"}
			</button>
			{expanded && (
				<div className="mt-3">
					{cursors.map((cursor, index) => (
						<RawChunk
							key={cursor}
							selection={selection}
							cursor={cursor}
							end={entry.end}
							last={index === cursors.length - 1}
							onNext={(next) => {
								void load(next);
								setCursors((current) => [...current, next]);
							}}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function RawChunk({
	selection,
	cursor,
	end,
	last,
	onNext,
}: {
	selection: StreamSelection;
	cursor: number;
	end: number;
	last: boolean;
	onNext: (next: number) => void;
}) {
	const query = logQuerySchema.parse({
		attempt: selection.attempt,
		stream: selection.stream,
		mode: "raw",
		cursor,
		end,
	});
	const resource = useLogResource(selection, query);
	const data = snapshot(resource);
	return (
		<>
			<ResourceNotice resource={resource} label="Raw details" />
			{data?.kind === "missing" && <p className="text-sm text-muted">{data.message}</p>}
			{data?.kind === "raw" && (
				<>
					<pre className="bee-log-raw">{data.text}</pre>
					{last && data.next !== null && (
						<button
							className="button mt-2"
							type="button"
							onClick={() => {
								onNext(data.next!);
							}}
						>
							Load more raw details
						</button>
					)}
				</>
			)}
			{resource.kind === "failed" && (
				<button
					className="button"
					type="button"
					onClick={() => {
						void loadLogs(selection.colonyId, selection.requestId, query, true);
					}}
				>
					Retry raw details
				</button>
			)}
		</>
	);
}

function EntrySummary({ entry }: { entry: LogEntry }) {
	return (
		<>
			<div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
				<strong className="break-all text-accent">{entry.kind}</strong>
				{entry.timestamp === null ? (
					<span className="text-muted">Time unavailable</span>
				) : (
					<time className="break-all text-muted">{entry.timestamp}</time>
				)}
			</div>
			<p className="mt-2 whitespace-pre-wrap break-words text-sm">{entry.content}</p>
		</>
	);
}
function TailNotice({ incomplete }: { incomplete: boolean }) {
	return (
		incomplete && (
			<p className="text-xs text-muted">
				An incomplete final line is withheld. Refresh to read it once complete.
			</p>
		)
	);
}
function useLogResource(selection: Selection, query: LogQuery) {
	const key = logKey(selection.colonyId, selection.requestId, query);
	return useStore(logs.store, (state) => state.entries[key] ?? EMPTY);
}
