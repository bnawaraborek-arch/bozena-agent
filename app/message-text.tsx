import type { ReactNode } from 'react';

function math(text: string): ReactNode[] {
  return text.split(/(\\frac\{[^{}]+\}\{[^{}]+\}|\\(?:times|cdot|div)|\^\{[^{}]+\}|_\{[^{}]+\}|\^[\w\d]|_[\w\d])/g).map((part, index) => {
    const fraction = /^\\frac\{([^{}]+)\}\{([^{}]+)\}$/.exec(part);
    if (fraction) return <span className="math-fraction" key={index}><span>{fraction[1]}</span><span>{fraction[2]}</span></span>;
    if (part === '\\times' || part === '\\cdot') return ' × ';
    if (part === '\\div') return ' ÷ ';
    if (/^\^[\w\d]$|^\^\{[^{}]+\}$/.test(part)) return <sup key={index}>{part.slice(1).replace(/^\{|\}$/g, '')}</sup>;
    if (/^_[\w\d]$|^_\{[^{}]+\}$/.test(part)) return <sub key={index}>{part.slice(1).replace(/^\{|\}$/g, '')}</sub>;
    return part;
  });
}

function inline(text: string): ReactNode[] {
  const pattern = /(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\)|`[^`\n]+`|\$[^$\n]+\$|\\\([^\n]+?\\\))/g;
  return text.split(pattern).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part);
    if (link) {
      try {
        const url = new URL(link[2]);
        if (url.protocol === 'http:' || url.protocol === 'https:') return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
      } catch { /* Nieprawidłowy link pozostaje tekstem. */ }
      return part;
    }
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('$') && part.endsWith('$')) return <span className="math" key={index}>{math(part.slice(1, -1))}</span>;
    if (part.startsWith('\\(') && part.endsWith('\\)')) return <span className="math" key={index}>{math(part.slice(2, -2))}</span>;
    return part;
  });
}

export function MessageText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  const isBlock = (line: string) => /^\s*(?:#{1,6}\s+|(?:[-*+]\s+)|(?:\d+[.)]\s+)|---\s*$|```|\$\$\s*$)/.test(line);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const key = i;
    if (/^\s*```/.test(line)) {
      const code: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(<pre key={key}><code>{code.join('\n')}</code></pre>); continue;
    }
    if (/^\s*\$\$\s*$/.test(line)) {
      const expression: string[] = []; i++;
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) expression.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(<div className="math math-block" key={key}>{math(expression.join('\n'))}</div>); continue;
    }
    if (/^\s*---\s*$/.test(line)) { blocks.push(<hr key={key} />); i++; continue; }
    const heading = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { const content = inline(heading[2]); blocks.push(<div className={`markdown-heading level-${heading[1].length}`} role="heading" aria-level={heading[1].length} key={key}>{content}</div>); i++; continue; }
    const list = /^\s*([-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (list) {
      const ordered = /^\d/.test(list[1]); const items: ReactNode[] = [];
      while (i < lines.length) {
        const item = /^\s*([-*+]|\d+[.)])\s+(.+)$/.exec(lines[i]);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(<li key={i}>{inline(item[2])}</li>); i++;
      }
      blocks.push(ordered ? <ol key={key} start={parseInt(list[1], 10)}>{items}</ol> : <ul key={key}>{items}</ul>); continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !isBlock(lines[i])) paragraph.push(lines[i++]);
    blocks.push(<p key={key}>{inline(paragraph.join('\n'))}</p>);
  }
  return <div className="markdown">{blocks}</div>;
}
