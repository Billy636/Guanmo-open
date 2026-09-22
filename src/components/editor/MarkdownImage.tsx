import { useEffect, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { isTauri, prepareMarkdownImage } from '@/hooks/useTauri'

interface MarkdownImageProps {
  src?: string
  alt?: string
  title?: string
  width?: string | number
  height?: string | number
  filePath?: string | null
  line?: number
  onZoom: (image: { src: string; alt: string }) => void
}

function localImagePath(src: string, filePath?: string | null): string | null {
  if (!src || /^(https?:|data:|blob:|asset:|file:)/i.test(src) || src.startsWith('#')) return null
  if (!filePath || !isTauri()) return null
  let decoded = src
  try { decoded = decodeURI(src) } catch { /* Keep malformed escapes as literal filename characters. */ }
  const normalized = decoded.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/')) return normalized
  const documentPath = filePath.replace(/\\/g, '/')
  const directory = documentPath.slice(0, documentPath.lastIndexOf('/'))
  return `${directory}/${normalized.replace(/^\.\//, '')}`
}

export function MarkdownImage({ src = '', alt = '', title, width, height, filePath, line, onZoom }: MarkdownImageProps) {
  const imagePath = localImagePath(src, filePath)
  const [prepared, setPrepared] = useState<{ filePath: string; imagePath: string; src?: string } | null>(null)

  useEffect(() => {
    if (!imagePath || !filePath) return
    let cancelled = false
    // Authorize this exact image before the browser starts an asset request. Opening
    // a standalone Markdown file does not authorize its sibling images by itself.
    void prepareMarkdownImage(filePath, imagePath).then((canonicalPath) => {
      if (!cancelled) setPrepared({ filePath, imagePath, src: convertFileSrc(canonicalPath) })
    }).catch(() => {
      if (!cancelled) setPrepared({ filePath, imagePath })
    })
    return () => { cancelled = true }
  }, [filePath, imagePath])

  const current = prepared && prepared.filePath === filePath && prepared.imagePath === imagePath ? prepared : null
  const resolvedSrc = imagePath ? current?.src : src
  const failed = Boolean(imagePath && current && !current.src)

  return (
    <button
      type="button"
      className="gm-markdown-image my-4 block max-w-full cursor-zoom-in rounded-xl border border-gm-border bg-transparent p-0 text-left"
      onClick={() => { if (resolvedSrc) onZoom({ src: resolvedSrc, alt }) }}
      title={failed ? '无法加载图片：请检查路径或通过打开文件夹授予访问权限' : '点击放大图片'}
      data-md-line={line}
    >
      <img
        src={resolvedSrc || undefined}
        alt={alt}
        title={title}
        width={width}
        height={height}
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        className="max-w-full rounded-xl"
      />
    </button>
  )
}
