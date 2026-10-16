'use client'

import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, Heading, List } from 'lucide-react'
import { renderMarkdown } from '@/lib/markdown'
import Tooltip from '@/components/ui/tooltip'

// A true WYSIWYG editor. Clicking Bold makes the selected text bold ON SCREEN —
// no symbols shown to the user. Stores plain markdown under the hood (so the
// preview, copy-summary, and backend are unchanged), converting to/from HTML at
// the edges. Uses execCommand (works in all current browsers) for the formatting.

function inlineMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()
  const inner = Array.from(el.childNodes).map(inlineMd).join('')
  if (tag === 'b' || tag === 'strong') return inner ? `**${inner}**` : ''
  if (tag === 'i' || tag === 'em') return inner ? `*${inner}*` : ''
  if (tag === 'br') return '\n'
  // Defensive: some browsers / pasted content use style-based bold/italic.
  const fw = el.style?.fontWeight
  const fst = el.style?.fontStyle
  let out = inner
  if (out && (fw === 'bold' || (fw && Number(fw) >= 600))) out = `**${out}**`
  if (out && fst === 'italic') out = `*${out}*`
  return out
}

const BLOCK_TAGS = ['DIV', 'P', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4']

function blockMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()
  if (tag === 'h1') return `# ${inlineMd(el).trim()}`
  if (tag === 'h2' || tag === 'h4') return `## ${inlineMd(el).trim()}`
  if (tag === 'h3') return `### ${inlineMd(el).trim()}`
  if (tag === 'ul') return Array.from(el.children).map((li) => `- ${inlineMd(li).trim()}`).join('\n')
  if (tag === 'ol') return Array.from(el.children).map((li, i) => `${i + 1}. ${inlineMd(li).trim()}`).join('\n')
  if (tag === 'li') return `- ${inlineMd(el).trim()}`
  if (tag === 'div' || tag === 'p') {
    const hasBlock = Array.from(el.childNodes).some((n) => n.nodeType === 1 && BLOCK_TAGS.includes((n as HTMLElement).tagName))
    if (hasBlock) return Array.from(el.childNodes).map(blockMd).filter((x) => x !== '').join('\n')
    return inlineMd(el)
  }
  return inlineMd(el)
}

function htmlToMarkdown(root: HTMLElement): string {
  const lines: string[] = []
  let buf = ''
  const flush = () => { if (buf.trim() !== '') lines.push(buf); buf = '' }
  // Group consecutive inline nodes (text + <b>/<em>/<span>) into ONE line; only
  // break on real block elements. Chrome leaves the first line loose at the root.
  root.childNodes.forEach((n) => {
    if (n.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.includes((n as HTMLElement).tagName)) {
      flush()
      const b = blockMd(n)
      if (b !== '') lines.push(b)
    } else {
      buf += inlineMd(n)
    }
  })
  flush()
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export default function RichEditor({
  value, onChange, disabled, minRows = 4, placeholder = '',
}: { value: string; onChange: (md: string) => void; disabled?: boolean; minRows?: number; placeholder?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [empty, setEmpty] = useState(!value.trim())

  // Hydrate from markdown ONCE on mount (the parent keys us by meeting id, so a
  // new meeting remounts fresh). After that it's uncontrolled → no cursor jumps.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    try { document.execCommand('styleWithCSS', false, 'false') } catch { /* older browsers */ }
    el.innerHTML = value.trim() ? renderMarkdown(value) : ''
    setEmpty(!el.textContent?.trim())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function sync() {
    const el = ref.current
    if (!el) return
    if (!el.textContent?.trim() && !el.querySelector('img,li')) { el.innerHTML = '' } // clear stray <br>/<div> so placeholder shows
    setEmpty(!el.textContent?.trim())
    onChange(htmlToMarkdown(el))
  }

  function cmd(command: string, arg?: string) {
    if (disabled) return
    ref.current?.focus()
    document.execCommand(command, false, arg)
    sync()
  }

  const proseCls = '[&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_b]:font-semibold [&_em]:italic [&_i]:italic'
  const toolBtn = 'inline-flex items-center justify-center w-7 h-7 rounded-[6px] text-text-secondary hover:bg-surface-control-pressed hover:text-text-primary'

  if (disabled) {
    return (
      <div
        className={`min-h-[80px] max-h-[300px] overflow-y-auto border border-border-light rounded-[8px] px-3 py-2 text-[15px] text-text-primary ${proseCls}`}
        dangerouslySetInnerHTML={{ __html: value.trim() ? renderMarkdown(value) : '<span class="text-text-muted">Nothing yet.</span>' }}
      />
    )
  }

  return (
    <div className="border border-border rounded-[8px] focus-within:border-primary focus-within:ring-1 focus-within:ring-primary overflow-hidden">
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-border-light bg-surface-sunken">
        {/* preventDefault keeps the text selection while the button is pressed */}
        <Tooltip label="Bold"><button type="button" aria-label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('bold')} className={toolBtn}><Bold size={15} /></button></Tooltip>
        <Tooltip label="Italic"><button type="button" aria-label="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('italic')} className={toolBtn}><Italic size={15} /></button></Tooltip>
        <Tooltip label="Heading"><button type="button" aria-label="Heading" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('formatBlock', 'H3')} className={toolBtn}><Heading size={15} /></button></Tooltip>
        <Tooltip label="Bullet list"><button type="button" aria-label="Bullet list" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertUnorderedList')} className={toolBtn}><List size={15} /></button></Tooltip>
      </div>
      <div className="relative">
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={sync}
          onBlur={sync}
          role="textbox"
          aria-multiline="true"
          className={`w-full px-3 py-2 text-[15px] text-text-primary focus:outline-hidden overflow-y-auto max-h-[420px] ${proseCls}`}
          style={{ minHeight: `${minRows * 1.6 + 1}rem` }}
        />
        {empty && placeholder && (
          <span className="pointer-events-none absolute left-3 top-2 text-[15px] text-text-muted">{placeholder}</span>
        )}
      </div>
    </div>
  )
}
