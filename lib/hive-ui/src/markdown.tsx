import type { ComponentProps } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Render native Markdown without changing its source or enabling raw HTML. */
export function MarkdownContent({ children }: { children: string }) {
	return (
		<div className="markdown-content text-sm leading-relaxed">
			<Markdown components={{ table: MarkdownTable }} remarkPlugins={[remarkGfm]}>
				{children}
			</Markdown>
		</div>
	);
}

function MarkdownTable({ children }: ComponentProps<"table">) {
	return (
		<div className="markdown-table">
			<table>{children}</table>
		</div>
	);
}
