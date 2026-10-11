import { useRef, useState } from 'react'
import { Layers3, RefreshCw, Upload } from 'lucide-react'

interface PdfUploadAreaProps {
  multiple?: boolean
  loading: boolean
  disabled: boolean
  buttonClassName: string
  onChoose: () => void
  onFiles: (files: FileList) => void
}

/** Shared upload presentation; parsing and workspace state remain in App. */
export function PdfUploadArea({ multiple, loading, disabled, buttonClassName, onChoose, onFiles }: PdfUploadAreaProps) {
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  return (
    <section
      className={`site-upload ${dragging ? 'is-dragging' : ''}`}
      aria-label={multiple ? '上传待合并的 PDF' : '上传待分割的 PDF'}
      aria-busy={loading}
      onDragEnter={(event) => { event.preventDefault(); dragDepth.current++; if (!disabled) setDragging(true) }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? 'none' : 'copy' }}
      onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) }}
      onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (!disabled) onFiles(event.dataTransfer.files) }}
    >
      <span className="upload-symbol" aria-hidden="true">
        {loading ? <RefreshCw className="animate-spin" size={28} /> : multiple ? <Layers3 size={28} /> : <Upload size={28} />}
      </span>
      <h2 className="upload-title">{dragging ? '松开以添加 PDF' : multiple ? '拖放多个 PDF 到这里' : '拖放 PDF 到这里'}</h2>
      <p className="upload-description">{multiple ? '添加后可选择页面，并调整合并顺序。' : '从设备或云盘选择文件，预览后按需分割。'}</p>
      <button className={buttonClassName} type="button" disabled={disabled} onClick={onChoose}>
        <Upload size={17} aria-hidden="true" /> {multiple ? '添加 PDF' : '选择 PDF'}
      </button>
      <p className="upload-note" role="status">{loading ? '正在读取 PDF…' : multiple ? '支持一次添加多个文件' : '支持 PDF 文件'}</p>
    </section>
  )
}
