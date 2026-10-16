// Minimal, dependency-free markdown → HTML for meeting agendas/minutes.
// HTML is escaped first, so only the explicit markdown subset becomes markup.
export function renderMarkdown(src: string): string {
  if (!src) return ''
  const esc = src
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const lines = esc.split('\n')
  const html: string[] = []
  let inList = false
  const closeList = () => {
    if (inList) {
      html.push('</ul>')
      inList = false
    }
  }

  const inline = (s: string) =>
    s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code class="bg-surface-control px-1 rounded-sm text-[13px]">$1</code>')

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^#{1,3}\s+/.test(line)) {
      closeList()
      const level = line.match(/^#+/)![0].length
      const text = inline(line.replace(/^#+\s+/, ''))
      const size = level === 1 ? 'text-[18px]' : level === 2 ? 'text-[16px]' : 'text-[15px]'
      html.push(`<p class="${size} font-semibold text-text-primary mt-3 mb-1">${text}</p>`)
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        html.push('<ul class="list-disc pl-5 my-1 flex flex-col gap-0.5">')
        inList = true
      }
      html.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`)
    } else if (line === '') {
      closeList()
      html.push('<div class="h-2"></div>')
    } else {
      closeList()
      html.push(`<p>${inline(line)}</p>`)
    }
  }
  closeList()
  return html.join('')
}
