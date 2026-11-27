export function splitKnowledgeText(text: string): string[] {
  const paragraphs = text.trim().split(/\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/).map(part => part.trim()).filter(Boolean);
  return paragraphs.flatMap(paragraph => {
    if (paragraph.length <= 800) return [paragraph];
    const sentences = paragraph.split(/(?<=[.!?])\s+/u);
    const chunks: string[] = [];
    let current = '';
    for (const sentence of sentences) {
      if (current && current.length + 1 + sentence.length > 800) { chunks.push(current); current = ''; }
      current = current ? `${current} ${sentence}` : sentence;
    }
    if (current) chunks.push(current);
    return chunks;
  });
}
