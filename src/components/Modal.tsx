import { useEffect, useRef, type ReactNode } from 'react';
export function Modal({children,onClose,className=''}:{children:ReactNode,onClose:()=>void,className?:string}) {
  const ref=useRef<HTMLDivElement>(null);
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const getFocusable=()=>Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')||[]).filter(e=>e.offsetParent!==null);
    const timer=window.setTimeout(()=>getFocusable()[0]?.focus(),40);
    const key=(event:KeyboardEvent)=>{ if(event.key==='Escape'){event.preventDefault();closeRef.current();} if(event.key==='Tab'){const all=getFocusable(); const first=all[0],last=all.at(-1); if(!first){event.preventDefault();return;} if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};
    document.addEventListener('keydown',key); const old=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{window.clearTimeout(timer);document.removeEventListener('keydown',key);document.body.style.overflow=old;previous?.focus();};
  },[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} className={`modal ${className}`} role="dialog" aria-modal="true">{children}</div></div>;
}
