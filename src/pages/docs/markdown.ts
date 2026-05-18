/**
 * Tiny CommonMark-ish renderer for the docs reference pages.
 *
 * Scope intentionally limited to what our agent-generated reports
 * actually use: ATX headings (# .. ####), bullet/numbered lists,
 * fenced code blocks (```...```), GFM tables (with leading-pipe
 * rows), inline code (`...`), bold/italic, and links.
 *
 * Not a general-purpose markdown library — produces HTML strings
 * that the Docs page sets via dangerouslySetInnerHTML on a div
 * already inside the React tree (Trust source: bundled .md files
 * from /tmp during build, no user-supplied content).
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(s: string): string {
  // Order matters: code first (so its inner doesn't get interpreted),
  // then bold/italic, then links.
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|\W)\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

type TableRow = { cells: string[]; head?: boolean };

function renderTable(lines: string[]): string {
  // lines is an array of pipe rows including the separator row.
  const rows: TableRow[] = [];
  let separatorSeen = false;
  for (const raw of lines) {
    const trimmed = raw.trim().replace(/^\|/, '').replace(/\|$/, '');
    if (/^[-:|\s]+$/.test(trimmed)) {
      separatorSeen = true;
      continue;
    }
    const cells = trimmed.split('|').map(c => c.trim());
    rows.push({ cells, head: !separatorSeen ? true : false });
  }
  const head = rows.filter(r => r.head);
  const body = rows.filter(r => !r.head);
  const renderCells = (r: TableRow, tag: 'th' | 'td') =>
    r.cells.map(c => `<${tag}>${inline(c)}</${tag}>`).join('');
  return [
    '<table>',
    head.length ? `<thead><tr>${renderCells(head[0], 'th')}</tr></thead>` : '',
    '<tbody>',
    ...body.map(r => `<tr>${renderCells(r, 'td')}</tr>`),
    '</tbody>',
    '</table>',
  ].join('');
}

export function mdToHtml(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      out.push(`<h${level + 2}>${inline(headingMatch[2])}</h${level + 2}>`);
      i++;
      continue;
    }

    // Table — detect by a row that starts with `|` followed by another that contains `---`
    if (line.trim().startsWith('|') && i + 1 < lines.length && /\|.*[-:].*\|/.test(lines[i + 1])) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        buf.push(lines[i]);
        i++;
      }
      out.push(renderTable(buf));
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      out.push(`<ul>${buf.map(b => `<li>${inline(b)}</li>`).join('')}</ul>`);
      continue;
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push(`<ol>${buf.map(b => `<li>${inline(b)}</li>`).join('')}</ol>`);
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].startsWith('>')
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}
