export function htmlToPlainText(html: string, maxLength = 200): string {
  if (!html) return '';

  let text = html.replace(/<[^>]*>/g, ' ');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}
