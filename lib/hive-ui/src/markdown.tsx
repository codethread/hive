import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Render native Markdown without changing its source or enabling raw HTML. */
export function MarkdownContent({ children }: { children: string }) {
	return (
		<div className="markdown-content text-sm leading-relaxed">
			<Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
		</div>
	);
}
