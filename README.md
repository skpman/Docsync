# DocSync

An offline-first collaborative document editor built with Next.js, Tiptap, and Yjs.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

For a production run, build first and then start the server:

```bash
npm run build
npm run start
```

## Collaboration

Documents persist locally in the browser through IndexedDB. To enable multi-user syncing, copy `.env.example` to `.env.local`, set `NEXT_PUBLIC_COLLAB_URL` to a y-websocket-compatible endpoint, and restart the development server.

The CRDT document is named `docsync:starter-document` for this initial slice. The next backend milestone is replacing that starter ID with database-backed document metadata and permissions.
