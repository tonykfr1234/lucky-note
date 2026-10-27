import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react';
import { Collaboration } from '@tiptap/extension-collaboration';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { api, getCsrf } from '../api';
import { isLocalMode } from '../runtime';
import { loadLocalDocument, type LocalDocumentHandle } from '../local-document';
import type { Lang } from '../types';
import { COLLAB_FIELD, SCHEMA_VERSION, createEditorExtensions, isSafeLink, serializeEditorJson } from '../../shared/editor-schema';
import { Icon } from './Icon';

type CollaborationInfo={documentName:string,wsPath:string,schemaVersion:number,readOnly:boolean,metadataVersion:number};
export type CollaborationState={phase:'loading'|'connecting'|'synced'|'pending'|'offline'|'error',ready:boolean,readOnly:boolean,localUnsent:boolean,pending:number,error:string};
export const INITIAL_COLLABORATION_STATE:CollaborationState={phase:'loading',ready:false,readOnly:true,localUnsent:false,pending:0,error:''};
export type ContentSnapshot={markdown:string,tasks:number,completed:number};
export type CollaborativeEditorHandle={setSketch:(serialized:string)=>void,waitUntilSynced:(timeoutMs?:number)=>Promise<void>,getMarkdown:()=>string};
type Props={noteId:string,lang:Lang,canEdit:boolean,source:boolean,onState:(state:CollaborationState)=>void,onContent:(snapshot:ContentSnapshot)=>void,onSketch:(serialized:string)=>void};
type Resource={doc:Y.Doc,provider:HocuspocusProvider|null};

function taskCounts(json:JSONContent):{tasks:number,completed:number}{
  let tasks=json.type==='taskItem'?1:0;let completed=json.type==='taskItem'&&json.attrs?.checked?1:0;
  for(const child of json.content||[]){const count=taskCounts(child);tasks+=count.tasks;completed+=count.completed;}
  return{tasks,completed};
}
function readSketch(value:unknown){if(typeof value!=='string'||!value)return'';try{return decodeURIComponent(escape(atob(value)));}catch{return'';}}

function RichDocument({doc,provider,editable,lang,source,onContent,onEditor}:{doc:Y.Doc,provider:HocuspocusProvider|null,editable:boolean,lang:Lang,source:boolean,onContent:(value:ContentSnapshot)=>void,onEditor:(editor:Editor|null)=>void}){
  const zh=lang==='zh-TW';const t=(a:string,b:string)=>zh?a:b;
  const callbacks=useRef({onContent,onEditor});callbacks.current={onContent,onEditor};
  const [linkError,setLinkError]=useState('');
  const [markdown,setMarkdown]=useState('');
  const publish=useCallback((editor:Editor)=>{const json=editor.getJSON();const output=serializeEditorJson(json);setMarkdown(output);callbacks.current.onContent({markdown:output,...taskCounts(json)});},[]);
  const editor=useEditor({
    extensions:[...createEditorExtensions(),Collaboration.configure({document:doc,field:COLLAB_FIELD,provider})],
    editable,immediatelyRender:false,shouldRerenderOnTransaction:true,
    editorProps:{attributes:{class:'collaborative-content',role:'textbox','aria-multiline':'true','aria-label':t('筆記內容編輯器','Note content editor'),spellcheck:'true'}},
    onCreate:({editor})=>{callbacks.current.onEditor(editor);publish(editor);},
    onUpdate:({editor})=>publish(editor),
    onDestroy:()=>callbacks.current.onEditor(null),
  },[doc]);
  useEffect(()=>{if(editor){editor.setEditable(editable);editor.setOptions({editorProps:{attributes:{class:'collaborative-content',role:'textbox','aria-multiline':'true','aria-label':t('筆記內容編輯器','Note content editor'),spellcheck:'true'}}});}},[editor,editable,lang]);
  useEffect(()=>{
    if(!editor)return;
    for(const item of editor.view.dom.querySelectorAll<HTMLLIElement>('li[data-type=taskItem]')){
      const input=item.querySelector<HTMLInputElement>(':scope > label input[type=checkbox]');
      if(input){input.disabled=!editable;input.setAttribute('aria-label',(zh?'完成：':'Complete: ')+(item.querySelector(':scope > div > p')?.textContent||''));}
    }
  },[editor,markdown,editable,zh]);
  function setLink(){if(!editor||!editable)return;const current=String(editor.getAttributes('link').href||'');const answer=window.prompt(t('連結網址（https://、http:// 或 mailto:）；留空可移除連結','Link URL (https://, http:// or mailto:); leave empty to remove'),current);if(answer===null)return;const href=answer.trim();if(!href){editor.chain().focus().extendMarkRange('link').unsetLink().run();setLinkError('');return;}if(!isSafeLink(href)){setLinkError(t('這個連結格式不受支援，請使用安全的網址。','This link format is not supported. Use a safe URL.'));return;}editor.chain().focus().extendMarkRange('link').setLink({href}).run();setLinkError('');}
  const button=(label:string,short:string,active:boolean,run:()=>void,disabled=false)=><button type="button" title={label} aria-label={label} aria-pressed={active} className={active?'active':''} disabled={!editable||disabled} onMouseDown={event=>event.preventDefault()} onClick={run}>{short}</button>;
  return <div className="collaborative-document" aria-label={t('文件編輯器','Document editor')}>
    {!source&&editor&&<div className="rich-toolbar" role="toolbar" aria-label={t('文字格式','Text formatting')}>
      <select aria-label={t('段落樣式','Text style')} value={editor.isActive('heading',{level:1})?'h1':editor.isActive('heading',{level:2})?'h2':editor.isActive('heading',{level:3})?'h3':'p'} disabled={!editable} onChange={event=>{if(event.target.value==='p')editor.chain().focus().setParagraph().run();else editor.chain().focus().toggleHeading({level:Number(event.target.value.slice(1)) as 1|2|3}).run();}}><option value="p">{t('段落','Paragraph')}</option><option value="h1">{t('標題一','Heading 1')}</option><option value="h2">{t('標題二','Heading 2')}</option><option value="h3">{t('標題三','Heading 3')}</option></select>
      <span className="toolbar-divider"/>
      {button(t('粗體','Bold'),'B',editor.isActive('bold'),()=>editor.chain().focus().toggleBold().run())}
      {button(t('斜體','Italic'),'I',editor.isActive('italic'),()=>editor.chain().focus().toggleItalic().run())}
      {button(t('刪除線','Strikethrough'),'S̶',editor.isActive('strike'),()=>editor.chain().focus().toggleStrike().run())}
      {button(t('行內程式碼','Inline code'),'< >',editor.isActive('code'),()=>editor.chain().focus().toggleCode().run())}
      <span className="toolbar-divider"/>
      {button(t('項目清單','Bullet list'),'•',editor.isActive('bulletList'),()=>editor.chain().focus().toggleBulletList().run())}
      {button(t('編號清單','Ordered list'),'1.',editor.isActive('orderedList'),()=>editor.chain().focus().toggleOrderedList().run())}
      {button(t('待辦清單','Task list'),'☑',editor.isActive('taskList'),()=>editor.chain().focus().toggleTaskList().run())}
      {button(t('引用','Blockquote'),'❝',editor.isActive('blockquote'),()=>editor.chain().focus().toggleBlockquote().run())}
      {button(t('程式碼區塊','Code block'),'{ }',editor.isActive('codeBlock'),()=>editor.chain().focus().toggleCodeBlock().run())}
      {button(t('編輯連結','Edit link'),'↗',editor.isActive('link'),setLink)}
      <span className="toolbar-divider"/>
      {button(t('復原文字','Undo text'),'↶',false,()=>editor.chain().focus().undo().run(),!editor.can().undo())}
      {button(t('重做文字','Redo text'),'↷',false,()=>editor.chain().focus().redo().run(),!editor.can().redo())}
    </div>}
    {linkError&&<p className="error" role="alert">{linkError}</p>}
    <div hidden={source}><EditorContent editor={editor}/></div>
    {source&&<><p className="source-readonly-notice">{t('Markdown 是目前文件的唯讀匯出檢視。請切回「文件」編輯。','Markdown is a read-only export of the current document. Switch to Document to edit.')}</p><textarea readOnly className="source-editor" aria-label={t('Markdown 內容','Markdown content')} value={markdown}/></>}
  </div>;
}

export const CollaborativeEditor=forwardRef<CollaborativeEditorHandle,Props>(function CollaborativeEditor({noteId,lang,canEdit,source,onState,onContent,onSketch},ref){
  const zh=lang==='zh-TW';const t=(a:string,b:string)=>zh?a:b;
  const [resource,setResource]=useState<Resource|null>(null);
  const [state,setState]=useState<CollaborationState>(INITIAL_COLLABORATION_STATE);
  const stateRef=useRef(state);stateRef.current=state;
  const resourceRef=useRef<Resource|null>(null);
  const editorRef=useRef<Editor|null>(null);
  const callbacks=useRef({onState,onContent,onSketch});callbacks.current={onState,onContent,onSketch};
  const permission=useRef(canEdit);permission.current=canEdit;
  useEffect(()=>{
    const controller=new AbortController();let active=true;let provider:HocuspocusProvider|null=null;let doc:Y.Doc|null=null;let localHandle:LocalDocumentHandle|null=null;
    let connected=false;let ready=false;let readOnly=true;let pending=0;let localUnsent=false;let failure='';
    const publish=()=>{if(!active)return;const phase:CollaborationState['phase']=failure?'error':!connected?(ready?'offline':'connecting'):!ready?'connecting':pending>0?'pending':'synced';const next={phase,ready,readOnly,localUnsent,pending,error:failure};stateRef.current=next;setState(next);callbacks.current.onState(next);};
    setResource(null);setState(INITIAL_COLLABORATION_STATE);stateRef.current=INITIAL_COLLABORATION_STATE;callbacks.current.onState(INITIAL_COLLABORATION_STATE);
    if(isLocalMode){
      void Promise.resolve().then(()=>active?loadLocalDocument(noteId):null).then(handle=>{
        if(!handle)return;
        if(!active){void handle.destroy();return;}
        localHandle=handle;doc=handle.doc;connected=true;ready=true;readOnly=false;
        const metadata=doc.getMap('metadata');
        const observeSketch=()=>{if(active)callbacks.current.onSketch(readSketch(metadata.get('sketch')));};
        metadata.observe(observeSketch);observeSketch();
        doc.on('update',(_update:Uint8Array,origin:unknown)=>{
          if(!active||origin==='local-storage'||origin==='local-peer')return;
          pending++;localUnsent=true;publish();
          void handle.save().then(()=>{pending=Math.max(0,pending-1);if(pending===0)localUnsent=false;publish();}).catch(()=>{failure='LOCAL_SAVE_FAILED';readOnly=true;publish();});
        });
        resourceRef.current={doc,provider:null};setResource({doc,provider:null});publish();
      }).catch(()=>{failure='LOCAL_LOAD_FAILED';publish();});
    }else void api<CollaborationInfo>(`/api/notes/${encodeURIComponent(noteId)}/collaboration`,{signal:controller.signal}).then(info=>{
      if(!active)return;
      if(info.schemaVersion!==SCHEMA_VERSION||info.documentName!==noteId||info.wsPath!=='/api/collaboration')throw new Error('COLLAB_SCHEMA_MISMATCH');
      readOnly=info.readOnly;doc=new Y.Doc();const metadata=doc.getMap('metadata');
      const observeSketch=()=>{if(active)callbacks.current.onSketch(readSketch(metadata.get('sketch')));};metadata.observe(observeSketch);
      const url=new URL(info.wsPath,window.location.origin);url.protocol=window.location.protocol==='https:'?'wss:':'ws:';
      provider=new HocuspocusProvider({
        url:url.toString(),name:info.documentName,document:doc,awareness:null,token:()=>getCsrf(),forceSyncInterval:20000,
        onStatus:({status})=>{connected=status==='connected';publish();},
        onAuthenticated:({scope})=>{readOnly=info.readOnly||scope==='readonly';publish();},
        onAuthenticationFailed:()=>{failure='COLLAB_ACCESS_DENIED';readOnly=true;publish();provider?.disconnect();},
        onSynced:({state:synced})=>{if(synced){ready=true;observeSketch();publish();}},
        onUnsyncedChanges:({number})=>{pending=number;if(number===0)localUnsent=false;publish();},
        onClose:({event})=>{
          connected=false;
          // Hocuspocus document CLOSE messages preserve the reason but use code 1000.
          const reason=event.reason||'';
          const rejected=/invalid or oversized|too large|invalid update/i.test(reason)||[1009,4400,4422].includes(event.code);
          const accessDenied=/permission|access revoked|session|csrf|read.only|document deleted|awareness|unsupported/i.test(reason)||[1008,4401,4403,4404].includes(event.code);
          if(rejected||accessDenied){failure=rejected?'COLLAB_UPDATE_REJECTED':'COLLAB_ACCESS_DENIED';readOnly=true;provider?.disconnect();}
          publish();
        },
        onDisconnect:()=>{connected=false;publish();},
      });
      const currentProvider=provider;
      doc.on('update',(_update:Uint8Array,origin:unknown)=>{if(origin!==currentProvider&&ready){localUnsent=true;publish();}});
      resourceRef.current={doc,provider};setResource({doc,provider});publish();
    }).catch(error=>{if(!active||error.name==='AbortError')return;failure=error.message==='COLLAB_SCHEMA_MISMATCH'?'COLLAB_SCHEMA_MISMATCH':'COLLAB_LOAD_FAILED';publish();});
    return()=>{active=false;controller.abort();resourceRef.current=null;editorRef.current=null;if(localHandle)void localHandle.destroy();else{provider?.destroy();doc?.destroy();}};
  },[noteId]);
  useImperativeHandle(ref,()=>({
    setSketch(serialized:string){const current=resourceRef.current;const status=stateRef.current;if(!current||!status.ready||status.readOnly||status.phase==='error'||!permission.current)throw new Error(t('目前無法編輯手寫資料。','Sketch editing is unavailable.'));if(serialized.length>250000)throw new Error(t('筆跡超過 250 KB。','Drawing exceeds 250 KB.'));const encoded=btoa(unescape(encodeURIComponent(serialized)));const metadata=current.doc.getMap('metadata');if(metadata.get('sketch')!==encoded)current.doc.transact(()=>metadata.set('sketch',encoded),'sketch-editor');},
    async waitUntilSynced(timeoutMs=10000){const start=Date.now();while(Date.now()-start<timeoutMs){const current=stateRef.current;if(current.phase==='synced'&&!current.localUnsent)return;if(current.phase==='error'&&isLocalMode)throw new Error(t('本機儲存失敗；請保留此分頁並匯出草稿。','Device storage failed. Keep this tab open and export your draft.'));if(current.phase==='error')throw new Error(t('同步被拒絕，請先下載草稿再重新登入。','Synchronization was denied. Download your draft before signing in again.'));if(current.phase==='offline')throw new Error(t('目前離線，變更只保留在這個分頁；請保持開啟並等待重新連線。','You are offline. Changes exist only in this tab. Keep it open while reconnecting.'));await new Promise(resolve=>setTimeout(resolve,75));}throw new Error(t('尚未收到同步確認。請保留此分頁並稍後再試。','Synchronization has not been acknowledged. Keep this tab open and try again.'));},
    getMarkdown(){return editorRef.current?serializeEditorJson(editorRef.current.getJSON()):'';},
  }),[lang]);
  const labels:Record<CollaborationState['phase'],string>={loading:isLocalMode?t('正在載入本機筆記…','Loading device note…'):t('正在載入協作文件…','Loading collaborative document…'),connecting:t('正在連線與同步…','Connecting and syncing…'),synced:isLocalMode?t('已儲存至此裝置','Saved on this device'):t('文件已同步','Document synced'),pending:isLocalMode?t('正在儲存至此裝置…','Saving on this device…'):t('正在同步變更…','Syncing changes…'),offline:t('離線 · 僅保留在此分頁','Offline · kept in this tab only'),error:isLocalMode?t('本機儲存無法繼續','Device storage stopped'):t('同步無法繼續','Synchronization stopped')};
  const errorMessage=state.error.startsWith('LOCAL_')?t('無法讀取或儲存此裝置的筆記。請保留本頁並匯出草稿；檢查裝置空間與瀏覽器儲存權限。','This device could not load or save the note. Keep this page open and export your draft. Check free storage and browser storage permissions.'):state.error==='COLLAB_UPDATE_REJECTED'?t('伺服器拒絕了這次文件更新，已停止編輯。請先匯出本地草稿，再重新開啟筆記。','The server rejected this document update and editing has stopped. Export your local draft before reopening the note.'):state.error==='COLLAB_SCHEMA_MISMATCH'?t('此文件使用不同的編輯器版本，已停止編輯以保護內容。請更新 App。','This document uses a different editor schema. Editing is blocked to protect it. Update the app.'):state.error==='COLLAB_ACCESS_DENIED'?t('登入已失效或權限已變更。請先下載草稿，再重新登入；不會自動覆寫遠端文件。','Your session expired or access changed. Download your draft before signing in again. The remote document will not be overwritten.'):t('無法載入協作文件。請確認連線與存取權後重新開啟筆記。','The collaborative document could not be loaded. Check your connection and access, then reopen the note.');
  const receiveEditor=useCallback((editor:Editor|null)=>{editorRef.current=editor;},[]);
  return <div className="collaborative-editor">
    <div className={`collaboration-status collaboration-${state.phase}`} data-state={state.phase} data-mode={isLocalMode?'device-only':'server'} role="status"><span className="status-dot"/>{labels[state.phase]}{state.readOnly&&state.ready&&<span className="readonly-badge">{t('唯讀','Read only')}</span>}</div>
    {state.phase==='error'&&<p className="error" role="alert">{errorMessage}</p>}
    {state.phase==='offline'&&<p className="info-banner">{t('保持這個分頁開啟。重新連線時會合併文件變更；關閉分頁、切換筆記或重新整理會遺失尚未同步的內容。本版沒有啟用裝置離線資料庫。','Keep this tab open. Document changes merge after reconnection. Closing, switching notes, or reloading loses unsynced changes. This version does not use a persistent offline database.')}</p>}
    {resource&&state.ready?<RichDocument doc={resource.doc} provider={resource.provider} editable={canEdit&&!state.readOnly&&state.phase!=='error'} lang={lang} source={source} onContent={value=>callbacks.current.onContent(value)} onEditor={receiveEditor}/>:state.phase!=='error'&&<div className="loading-content"><span className="spinner"/><span>{t('等待伺服器的文件內容','Waiting for the server document')}</span></div>}
    <p className="collaboration-footnote"><Icon name="lock" size={13}/>{isLocalMode?t('內容與畫布自動儲存至此裝置；標題、標籤和筆記本需按「儲存」。沒有跨裝置同步。','Content and sketches save on this device. Use Save for title, tags and notebook changes. There is no cross-device sync.'):t('內容與筆跡自動同步；標題、標籤和筆記本需按「儲存」。','Content and sketches sync automatically. Use Save for title, tags, and notebook changes.')}</p>
  </div>;
});
