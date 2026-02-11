import React, { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";

const ChartExtension = Node.create({
  name: "chart",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      dataChart: {
        default: "{}",
        parseHTML: (el) => el.getAttribute("data-chart") || "{}",
        renderHTML: (attrs) => ({ "data-chart": attrs.dataChart }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[class*="assignment-chart"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { class: "assignment-chart", ...HTMLAttributes }];
  },
  addNodeView() {
    return ({ node }) => {
      const div = document.createElement("div");
      div.className = "assignment-chart-editor";
      div.textContent = "📊 Chart";
      div.contentEditable = "false";
      div.setAttribute("data-chart", node.attrs.dataChart);
      return { dom: div };
    };
  },
});

function ChartInsertModal({ onInsert, onCancel }) {
  const [type, setType] = useState("bar");
  const [title, setTitle] = useState("");
  const [labelsStr, setLabelsStr] = useState("A, B, C");
  const [valuesStr, setValuesStr] = useState("10, 20, 15");

  const handleInsert = () => {
    const labels = labelsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const values = valuesStr
      .split(",")
      .map((s) => Number(s.trim()) || 0)
      .filter((_, i) => i < labels.length);
    if (labels.length === 0 || values.length === 0) return;
    const chartData = JSON.stringify({
      type,
      title: title || undefined,
      labels,
      data: values,
    });
    onInsert(
      `<div class="assignment-chart" data-chart='${chartData.replace(
        /'/g,
        "&#39;"
      )}'></div>`
    );
    onCancel();
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Insert chart</h3>
        <div className="form-block">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="bar">Bar</option>
            <option value="line">Line</option>
            <option value="pie">Pie</option>
          </select>
          <input
            placeholder="Chart title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            placeholder="Labels (comma-separated, e.g. A, B, C)"
            value={labelsStr}
            onChange={(e) => setLabelsStr(e.target.value)}
          />
          <input
            placeholder="Values (comma-separated, e.g. 10, 20, 15)"
            value={valuesStr}
            onChange={(e) => setValuesStr(e.target.value)}
          />
          <div className="modal-actions">
            <button type="button" onClick={handleInsert}>
              Insert
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const ToolbarBtn = ({ onClick, active, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={active ? "active" : ""}
    title={title}
  >
    {children}
  </button>
);

const ToolbarDivider = () => <span className="toolbar-divider" />;

function MenuBar({ editor, onInsertChart, onAttachFiles, filesCount, fileInputRef }) {
  if (!editor) return null;
  return (
    <div className="gdocs-toolbar">
      <div className="toolbar-row">
        <div className="toolbar-group">
          <ToolbarBtn
            onClick={() => editor.chain().focus().undo().run()}
            title="Undo"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
            </svg>
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().redo().run()}
            title="Redo"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z" />
            </svg>
          </ToolbarBtn>
        </div>
        <ToolbarDivider />
        <div className="toolbar-group">
          <select
            value={
              editor.isActive("heading")
                ? editor.getAttributes("heading").level
                : "p"
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === "p") editor.chain().focus().setParagraph().run();
              else
                editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: Number(v) })
                  .run();
            }}
            className="format-select"
          >
            <option value="p">Normal text</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
          </select>
        </div>
        <ToolbarDivider />
        <div className="toolbar-group">
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            title="Bold"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" />
            </svg>
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            title="Italic"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z" />
            </svg>
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive("underline")}
            title="Underline"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z" />
            </svg>
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            title="Strikethrough"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z" />
            </svg>
          </ToolbarBtn>
        </div>
        <ToolbarDivider />
        <div className="toolbar-group">
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            title="Bullet list"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z" />
            </svg>
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            title="Numbered list"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z" />
            </svg>
          </ToolbarBtn>
        </div>
        <ToolbarDivider />
        <div className="toolbar-group">
          <ToolbarBtn
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            active={editor.isActive({ textAlign: "left" })}
            title="Align left"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z" />
            </svg>
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            active={editor.isActive({ textAlign: "center" })}
            title="Align center"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z" />
            </svg>
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            active={editor.isActive({ textAlign: "right" })}
            title="Align right"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 21h18v-2H3v2zm6-4h12v-2H9v2zm-6-4h18v-2H3v2zm6-4h12V7H9v2zM3 3v2h18V3H3z" />
            </svg>
          </ToolbarBtn>
        </div>
        <ToolbarDivider />
        <div className="toolbar-group">
          <ToolbarBtn
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
            title="Insert table"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3v18h18V3H3zm16 16H5V5h14v14zm-2-12H7v4h10V7zm0 6H7v4h10v-4zM9 7h4v4H9V7z" />
            </svg>
          </ToolbarBtn>
          <ToolbarBtn onClick={onInsertChart} title="Insert chart">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" />
            </svg>
          </ToolbarBtn>
          {onAttachFiles && (
            <>
              <ToolbarDivider />
              <div className="toolbar-group">
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  className="hidden-file-input"
                  onChange={(e) => {
                    const list = e.target.files ? Array.from(e.target.files) : [];
                    if (list.length) onAttachFiles(list);
                    e.target.value = "";
                  }}
                />
                <ToolbarBtn
                  onClick={() => fileInputRef?.current?.click()}
                  title="Attach files (or drag & drop into content)"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z" />
                  </svg>
                  {filesCount > 0 && (
                    <span className="toolbar-attach-count">{filesCount}</span>
                  )}
                </ToolbarBtn>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function RichTextEditor({ value, onChange, placeholder, onFilesAdded, filesCount = 0 }) {
  const [showChartModal, setShowChartModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      ChartExtension,
    ],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "editor-content",
        "data-placeholder": placeholder || "Start typing...",
      },
      handleDrop: () => true,
      handlePaste: () => true,
    },
  });

  useEffect(() => {
    if (editor && value !== undefined && editor.getHTML() !== value) {
      editor.commands.setContent(value || "", false);
    }
  }, [value]);

  const handleInsertChart = (html) => {
    if (editor) {
      editor.chain().focus().insertContent(html).run();
      onChange(editor.getHTML());
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (onFilesAdded && e.dataTransfer.files?.length) {
      onFilesAdded(Array.from(e.dataTransfer.files));
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onFilesAdded) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false);
  };

  return (
    <div className="gdocs-editor">
      <MenuBar
        editor={editor}
        onInsertChart={() => setShowChartModal(true)}
        onAttachFiles={onFilesAdded}
        filesCount={filesCount}
        fileInputRef={fileInputRef}
      />
      <div
        className={`gdocs-doc ${isDragging ? "gdocs-doc-dragging" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <EditorContent editor={editor} />
      </div>
      {showChartModal && (
        <ChartInsertModal
          onInsert={handleInsertChart}
          onCancel={() => setShowChartModal(false)}
        />
      )}
    </div>
  );
}
