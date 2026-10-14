import type { Editor } from '@tiptap/react';

interface Item {
  label: string;
  title: string;
  run: (e: Editor) => unknown;
  active?: (e: Editor) => boolean;
}

const items: (Item | '|')[] = [
  { label: '↶', title: 'Undo your last edit', run: (e) => e.chain().focus().undo().run() },
  { label: '↷', title: 'Redo', run: (e) => e.chain().focus().redo().run() },
  '|',
  { label: 'H1', title: 'Heading 1', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive('heading', { level: 1 }) },
  { label: 'H2', title: 'Heading 2', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }) },
  '|',
  { label: 'B', title: 'Bold', run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
  { label: 'I', title: 'Italic', run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
  { label: 'S', title: 'Strikethrough', run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive('strike') },
  { label: '</>', title: 'Inline code', run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive('code') },
  '|',
  { label: '•', title: 'Bullet list', run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { label: '1.', title: 'Numbered list', run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
  { label: '❝', title: 'Quote', run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
  { label: '{ }', title: 'Code block', run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive('codeBlock') },
];

export function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="toolbar" />;
  return (
    <div className="toolbar" role="toolbar">
      {items.map((item, i) =>
        item === '|' ? (
          <span key={i} className="sep" />
        ) : (
          <button
            key={item.title}
            title={item.title}
            className={item.active?.(editor) ? 'active' : ''}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => item.run(editor)}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
