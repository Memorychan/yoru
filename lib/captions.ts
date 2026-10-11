export function captionText(source: string): string {
  const text = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (/^WEBVTT(?:\s|$)/.test(text)) return text + '\n';
  const converted = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  if (!/\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/.test(converted))
    throw new Error('Choose a valid WebVTT (.vtt) or SubRip (.srt) caption file.');
  return `WEBVTT\n\n${converted}\n`;
}
