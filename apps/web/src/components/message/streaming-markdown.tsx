/**
 * StreamingMarkdown — incremental markdown renderer for token streams.
 *
 * Design invariants:
 *   1. Input is a growing string (tokens appended left→right).
 *   2. The TAIL (last incomplete line) renders as raw text — prevents
 *      flickering on partial syntax like `**bold` being actively typed.
 *   3. Completed lines (preceding newlines) get full inline formatting.
 *   4. Code blocks accumulate until closing ```. Partial code blocks show
 *      all accumulated lines as-is (no spurious formatting inside code).
 *   5. React.memo: parent passes content string → same string → bail out.
 *   6. Zero external dependencies. ~200 lines, tree-shakeable.
 *
 * Supported syntax:
 *   Block: ``` code blocks (with optional language), # headings, - bullet lists, numbered lists
 *   Inline: **bold**, *italic*, `code`, plain text
 *
 * Not supported (kept minimal intentionally):
 *   Tables, blockquotes, nested lists, HTML, links
 *   These can be added in Phase 8 (full document rendering).
 */

import React from 'react';

// ─── AST types ────────────────────────────────────────────────────────────────

type InlineNode =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'code'; v: string };

type BlockNode =
  | { t: 'paragraph'; lines: string[] }
  | { t: 'heading'; level: 1 | 2 | 3; text: string }
  | { t: 'code-block'; lang: string; lines: string[]; closed: boolean }
  | { t: 'list'; ordered: boolean; items: string[] }
  | { t: 'table'; headers: string[]; rows: string[][] }
  | { t: 'hr' };

// ─── Inline parser ────────────────────────────────────────────────────────────
// Only applied to completed lines — never to the tail.

function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;

  while (i < text.length) {
    // Bold: **text**
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        nodes.push({ t: 'bold', v: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    // Italic: *text* (not **)
    if (text[i] === '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      if (end !== -1 && text[end + 1] !== '*') {
        nodes.push({ t: 'italic', v: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Inline code: `code`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        nodes.push({ t: 'code', v: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Accumulate plain text
    const start = i;
    while (
      i < text.length &&
      !(text[i] === '*') &&
      !(text[i] === '`')
    ) i++;
    if (i > start) nodes.push({ t: 'text', v: text.slice(start, i) });
    if (i === start) i++; // stuck — advance past unmatched delimiter
  }

  return nodes;
}

// ─── Table helpers ────────────────────────────────────────────────────────────

function parseTableRow(line: string): string[] {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

// ─── Block parser ─────────────────────────────────────────────────────────────
// Parses completed lines only. Returns an array of block nodes + the tail.

interface ParseResult {
  blocks: BlockNode[];
  tail: string;    // last incomplete line — rendered raw
}

export function parseStreamingMarkdown(content: string): ParseResult {
  if (!content) return { blocks: [], tail: '' };

  const lastNl = content.lastIndexOf('\n');
  const completedText = lastNl >= 0 ? content.slice(0, lastNl) : '';
  const tail = lastNl >= 0 ? content.slice(lastNl + 1) : content;

  if (!completedText) return { blocks: [], tail };

  const lines = completedText.split('\n');
  const blocks: BlockNode[] = [];

  let i = 0;
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];

  while (i < lines.length) {
    const line = lines[i]!;

    // Code block start/end
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        blocks.push({ t: 'code-block', lang: codeLang, lines: codeLines, closed: true });
        inCodeBlock = false;
        codeLines = [];
        codeLang = '';
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      i++;
      continue;
    }

    // Heading: #, ##, ###
    const headingMatch = /^(#{1,3})\s+(.+)/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]!.length as 1 | 2 | 3;
      blocks.push({ t: 'heading', level, text: headingMatch[2]! });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }

    // Bullet list: - item or * item
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ t: 'list', ordered: false, items });
      continue;
    }

    // Numbered list: 1. item
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ t: 'list', ordered: true, items });
      continue;
    }

    // Table: | header | header | followed by |---|---|
    if (line.startsWith('|')) {
      const sepLine = lines[i + 1] ?? '';
      if (isTableSeparator(sepLine)) {
        const headers = parseTableRow(line);
        i += 2; // skip header row + separator row
        const rows: string[][] = [];
        while (i < lines.length && lines[i]!.startsWith('|')) {
          rows.push(parseTableRow(lines[i]!));
          i++;
        }
        blocks.push({ t: 'table', headers, rows });
        continue;
      }
      // Lone | line — fall through to paragraph
    }

    // Blank line — separates paragraphs (skip)
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: accumulate non-blank lines (stop at block-level markers)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.startsWith('#') &&
      !lines[i]!.startsWith('```') &&
      !lines[i]!.startsWith('|') &&
      !/^[-*]\s+/.test(lines[i]!) &&
      !/^\d+\.\s+/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    if (paraLines.length > 0) blocks.push({ t: 'paragraph', lines: paraLines });
  }

  // Unclosed code block — still accumulating
  if (inCodeBlock) {
    blocks.push({ t: 'code-block', lang: codeLang, lines: codeLines, closed: false });
  }

  return { blocks, tail };
}

// ─── Inline renderer ──────────────────────────────────────────────────────────

function RenderInline({ text }: { text: string }) {
  const nodes = parseInline(text);
  return (
    <>
      {nodes.map((node, idx) => {
        switch (node.t) {
          case 'bold':   return <strong key={idx}>{node.v}</strong>;
          case 'italic': return <em key={idx}>{node.v}</em>;
          case 'code':   return <code key={idx} style={INLINE_CODE_STYLE}>{node.v}</code>;
          default:       return <React.Fragment key={idx}>{node.v}</React.Fragment>;
        }
      })}
    </>
  );
}

// ─── Block renderers ──────────────────────────────────────────────────────────

function RenderBlock({ block }: { block: BlockNode }) {
  switch (block.t) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3';
      return <Tag style={HEADING_STYLE[block.level]}><RenderInline text={block.text} /></Tag>;
    }

    case 'paragraph':
      return (
        <p style={PARA_STYLE}>
          {block.lines.map((line, i) => (
            <React.Fragment key={i}>
              {i > 0 && <br />}
              <RenderInline text={line} />
            </React.Fragment>
          ))}
        </p>
      );

    case 'code-block':
      return (
        <div style={CODE_BLOCK_WRAPPER}>
          {block.lang && (
            <div style={CODE_LANG_LABEL}>
              {block.lang}
              {!block.closed && (
                <span style={{ color: '#38bdf8', marginLeft: 8, fontSize: 9 }}>streaming…</span>
              )}
            </div>
          )}
          <pre style={CODE_BLOCK_PRE}>
            <code>{block.lines.join('\n')}</code>
          </pre>
        </div>
      );

    case 'list':
      return block.ordered ? (
        <ol style={LIST_STYLE}>
          {block.items.map((item, i) => (
            <li key={i}><RenderInline text={item} /></li>
          ))}
        </ol>
      ) : (
        <ul style={LIST_STYLE}>
          {block.items.map((item, i) => (
            <li key={i}><RenderInline text={item} /></li>
          ))}
        </ul>
      );

    case 'table':
      return (
        <div style={TABLE_WRAPPER_STYLE}>
          <table style={TABLE_STYLE}>
            <thead>
              <tr>
                {block.headers.map((h, ci) => (
                  <th key={ci} style={TH_STYLE}><RenderInline text={h} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} style={ri % 2 === 1 ? TR_ALT_STYLE : TR_STYLE}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={TD_STYLE}><RenderInline text={cell} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'hr':
      return <hr style={HR_STYLE} />;
  }
}

// ─── StreamingMarkdown component ──────────────────────────────────────────────

interface StreamingMarkdownProps {
  /** The full accumulated content string from the stream. */
  content: string;
  /** Whether the cursor should show (status === 'streaming'). */
  showCursor?: boolean;
}

export const StreamingMarkdown = React.memo(function StreamingMarkdown({
  content,
  showCursor = false,
}: StreamingMarkdownProps) {
  const { blocks, tail } = parseStreamingMarkdown(content);

  return (
    <div style={CONTAINER_STYLE} className="markdown-body">
      {blocks.map((block, i) => (
        <RenderBlock key={i} block={block} />
      ))}

      {/* Tail: raw text, currently being typed */}
      {tail && (
        <p style={{ ...PARA_STYLE, margin: 0 }}>
          <span style={{ whiteSpace: 'pre-wrap' }}>{tail}</span>
          {showCursor && <Cursor />}
        </p>
      )}
      {/* Cursor at end when no tail but still streaming */}
      {!tail && showCursor && (
        <span style={{ display: 'inline-block' }}><Cursor /></span>
      )}
    </div>
  );
});

StreamingMarkdown.displayName = 'StreamingMarkdown';

// ─── Cursor ───────────────────────────────────────────────────────────────────

function Cursor() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: '2px',
        height: '1.15em',
        verticalAlign: 'text-bottom',
        background: 'var(--color-accent, #38bdf8)',
        borderRadius: '1px',
        marginLeft: '1px',
        animation: 'pulse-cursor 1s step-end infinite',
      }}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CONTAINER_STYLE: React.CSSProperties = {
  lineHeight: 1.65,
  fontSize: '0.9375rem',
  color: 'var(--msg-text, #e2e8f0)',
};

const PARA_STYLE: React.CSSProperties = {
  margin: '0 0 0.75em',
  whiteSpace: 'pre-wrap',
};

const HEADING_STYLE: Record<1 | 2 | 3, React.CSSProperties> = {
  1: { fontSize: '1.4em', fontWeight: 700, margin: '0.5em 0 0.4em', color: 'var(--msg-heading, #f1f5f9)' },
  2: { fontSize: '1.2em', fontWeight: 600, margin: '0.5em 0 0.35em', color: 'var(--msg-heading, #f1f5f9)' },
  3: { fontSize: '1.05em', fontWeight: 600, margin: '0.5em 0 0.3em', color: 'var(--msg-heading, #f1f5f9)' },
};

const INLINE_CODE_STYLE: React.CSSProperties = {
  fontFamily: '"JetBrains Mono", "Fira Mono", monospace',
  fontSize: '0.875em',
  background: 'rgba(56, 189, 248, 0.08)',
  color: '#93c5fd',
  padding: '0.1em 0.35em',
  borderRadius: '3px',
  border: '1px solid rgba(56, 189, 248, 0.15)',
};

const CODE_BLOCK_WRAPPER: React.CSSProperties = {
  margin: '0.75em 0',
  background: '#0d1117',
  border: '1px solid #21262d',
  borderRadius: '6px',
  overflow: 'hidden',
};

const CODE_LANG_LABEL: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: '10px',
  fontFamily: '"JetBrains Mono", "Fira Mono", monospace',
  fontWeight: 600,
  color: '#8b949e',
  background: '#161b22',
  borderBottom: '1px solid #21262d',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  display: 'flex',
  alignItems: 'center',
};

const CODE_BLOCK_PRE: React.CSSProperties = {
  margin: 0,
  padding: '12px 16px',
  overflowX: 'auto',
  fontFamily: '"JetBrains Mono", "Fira Mono", "Cascadia Code", monospace',
  fontSize: '0.8125rem',
  lineHeight: 1.6,
  color: '#e6edf3',
  whiteSpace: 'pre',
};

const LIST_STYLE: React.CSSProperties = {
  margin: '0 0 0.75em',
  paddingLeft: '1.5em',
};

const HR_STYLE: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #21262d',
  margin: '1em 0',
};

const TABLE_WRAPPER_STYLE: React.CSSProperties = {
  margin: '0.75em 0',
  overflowX: 'auto',
  borderRadius: '6px',
  border: '1px solid #2a2826',
};

const TABLE_STYLE: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: '"JetBrains Mono", "Fira Mono", monospace',
  fontSize: '0.8125rem',
};

const TH_STYLE: React.CSSProperties = {
  padding: '8px 14px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: '0.75rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#8b949e',
  background: '#161b22',
  borderBottom: '1px solid #2a2826',
  whiteSpace: 'nowrap',
};

const TR_STYLE: React.CSSProperties = {
  borderBottom: '1px solid #1e1c1a',
};

const TR_ALT_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.02)',
  borderBottom: '1px solid #1e1c1a',
};

const TD_STYLE: React.CSSProperties = {
  padding: '7px 14px',
  color: '#e6edf3',
  verticalAlign: 'top',
};
