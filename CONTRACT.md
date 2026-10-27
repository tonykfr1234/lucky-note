# Implementation contract (internal)

Node 22.17+, ESM TypeScript. React 19 + Vite 7. API JSON responses, errors `{error:string, code?:string}`. Server receives same-origin session cookies; client sends `X-CSRF-Token` from session response on all authenticated mutations. IDs opaque UUIDs. All money is integer minor units; TWD default. Files base64 JSON, maximum decoded 20 MB, image/video/audio/PDF MIME whitelist, no SVG/HTML uploads. No service worker caching of private API/files.

- `GET /api/session` -> `{user:null|User,csrfToken:string,googleConfigured:boolean}`. User `{id,name,email,avatar?:string}`.
- `POST /api/auth/register` `{name,email,password}` / `POST /api/auth/login` `{email,password}` -> session shape. `POST /api/auth/logout`.
- `PATCH /api/profile` `{name?,avatar?}` -> `{user}`. avatar is bounded PNG/JPEG/WebP data URL or empty.
- `GET /api/workspaces` -> `{workspaces:Workspace[]}`. Workspace `{id,name,type:'private'|'group',role:'owner'|'editor'|'viewer'}`.
- `POST /api/workspaces` `{name,type}` -> `{workspace}`.
- `GET /api/workspaces/:id/members` -> `{members:[{id,name,email,role}]}`; POST `{email,role:'editor'|'viewer'}` adds existing registered account, owner only, no email send. DELETE `.../members/:userId` owner only.
- `GET /api/workspaces/:id/notebooks` -> `{notebooks:[{id,name}]}`; POST `{name}`.
- `GET /api/workspaces/:id/notes` -> `{notes:Note[]}`; POST `{title,content,tags,notebookId?,template?,clientMutationId}` -> `{note}`.
- `GET /api/notes/:id` -> `{note}`; PATCH `{title,content,tags,notebookId?,version}` -> `{note}`, 409 on conflict. DELETE requires `{version}`.
- Note `{id,workspaceId,title,content,tags:string[],notebookId:string|null,template:string,version:number,updatedAt:string,createdAt:string}`. Markdown-like plaintext body supports checkbox editing; no HTML rendering.
- `GET /api/notes/:id/attachments` -> `{attachments:[{id,name,mime,size,url}]}`; POST `{name,mime,data,clientMutationId}` -> `{attachment}` where data is raw base64. `GET /api/files/:id` membership protected; DELETE `/api/attachments/:id`.
- `GET /api/workspaces/:id/events` SSE `data: {kind:string,noteId?:string}`. Check membership again on event, close on logout/membership revocation.
- `GET /api/workspaces/:id/expenses` -> `{expenses:Expense[],balances:[{userId,name,balance}],settlements:[{from,to,amount}],currency:'TWD'}`. Expense `{id,description,amount,payerId,participantIds:string[],createdAt}`. POST `{description,amount,payerId,participantIds,clientMutationId}`; DELETE `/api/expenses/:id`. No transfer; suggestions only.
- `GET /api/integrations` -> `{integrations:[{id,name,configured,description,missing:string[]}]}`.
- Integration API described in `server/integrations.ts` by integration owner; frontend ToolsPanel agent will coordinate root.

Frontend owns src/App.tsx, src/style.css, src/api.ts, src/types.ts, src/components/*, public/* except root build files. Backend owns server/core.ts, server/index.ts, server/types.ts and tests/core.test.ts. Integrations owner owns server/integrations.ts, server/providers.ts and tests/integrations.test.ts. Root owns configs, docs, scripts, e2e tests, packaging and final integration. Do not edit another owner's file without coordinating.
