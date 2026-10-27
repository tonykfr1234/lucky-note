import { useEffect, useRef, useState } from 'react';
import { api, fileData } from '../api';
import type { Lang, User } from '../types';
import { Modal } from './Modal';
import { Icon } from './Icon';
export type Preferences={lang:Lang,theme:'light'|'dark',background:number,customBackground:string,galleryBackground:string,brandName:string,brandIcon:string};
export const defaultPreferences:Preferences={lang:'zh-TW',theme:'light',background:0,customBackground:'',galleryBackground:'',brandName:'',brandIcon:''};
export const backgroundNames=[['紙白','Paper'],['薄荷晨光','Mint morning'],['沙丘','Dunes'],['紫霧','Lavender mist'],['藍圖','Blueprint'],['桃色微風','Peach breeze'],['森林','Forest'],['夜空','Night sky'],['細雨','Rain'],['幾何花園','Garden']];
type GalleryBackground={id:string,label:string,label_zh:string,url:string,thumbnail_url:string};
function BackgroundGallery({preferences,onChange}:{preferences:Preferences,onChange:(patch:Partial<Preferences>)=>void}){
  const [backgrounds,setBackgrounds]=useState<GalleryBackground[]>([]);
  const [loading,setLoading]=useState(true);
  const [failed,setFailed]=useState(false);
  const zh=preferences.lang==='zh-TW';
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/backgrounds/manifest.json',{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('Background collection unavailable');
      const value:unknown=await response.json();
      if(!Array.isArray(value))throw new Error('Invalid background collection');
      const items=value.filter((item):item is GalleryBackground=>!!item&&typeof item.id==='string'&&typeof item.label==='string'&&typeof item.label_zh==='string'&&typeof item.url==='string'&&typeof item.thumbnail_url==='string'&&/^\/backgrounds\/background-\d{2}\.webp$/.test(item.url)&&/^\/backgrounds\/background-\d{2}-thumb\.webp$/.test(item.thumbnail_url));
      if(!controller.signal.aborted)setBackgrounds(items);
    }).catch(error=>{if(error.name!=='AbortError')setFailed(true);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[]);
  return <section className="background-gallery" aria-labelledby="background-gallery-title">
    <h4 id="background-gallery-title">{zh?'AI 生成背景收藏':'AI-generated background collection'}</h4>
    <p className="muted">{zh?'10 款專為筆記空間生成的背景。先看縮圖，只下載你選中的完整圖片。':'10 backgrounds generated for your notebook. Preview thumbnails; only the selected full image is downloaded.'}</p>
    {loading&&<p className="muted" role="status">{zh?'正在載入背景收藏…':'Loading the background collection…'}</p>}
    {failed&&<p className="error" role="alert">{zh?'背景收藏暫時無法載入，仍可使用下方程序背景或上傳自己的圖片。':'The collection is unavailable. You can still use procedural backgrounds or upload an image below.'}</p>}
    <div className="gallery-background-grid">{backgrounds.map(item=>{
      const selected=preferences.galleryBackground===item.url&&!preferences.customBackground;
      return <button key={item.id} className={`gallery-background-option ${selected?'selected':''}`} aria-label={`${zh?'選擇背景：':'Choose background: '}${zh?item.label_zh:item.label}`} aria-pressed={selected} onClick={()=>onChange({galleryBackground:item.url,customBackground:''})}>
        <img src={item.thumbnail_url} alt="" width={320} height={180} loading="lazy" decoding="async"/>
        <span>{zh?item.label_zh:item.label}</span>{selected&&<Icon name="check" size={16}/>}
      </button>;
    })}</div>
  </section>;
}
export default function SettingsPanel({preferences,onChange,user,onUser,onClose}:{preferences:Preferences,onChange:(p:Preferences)=>void,user:User,onUser:(u:User)=>void,onClose:()=>void}){
  const zh=preferences.lang==='zh-TW';const t=(a:string,b:string)=>zh?a:b;
  const[name,setName]=useState(user.name);const[error,setError]=useState('');const[notice,setNotice]=useState('');const[busy,setBusy]=useState(false);const avatarRef=useRef<HTMLInputElement>(null);
  const set=(patch:Partial<Preferences>)=>onChange({...preferences,...patch});
  async function saveProfile(avatar?:string){setBusy(true);setError('');try{const r=await api<{user:User}>('/api/profile',{method:'PATCH',body:JSON.stringify({name,...(avatar===undefined?{}:{avatar})})});onUser(r.user);setNotice(t('個人資料已更新','Profile updated'));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function chooseImage(file:File,kind:'avatar'|'icon'|'background'){if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>512*1024){setError(t('請選擇 512 KB 以內的 PNG、JPEG 或 WebP 圖片。','Choose a PNG, JPEG or WebP image smaller than 512 KB.'));return;}const data=await fileData(file);if(kind==='avatar')await saveProfile(data);if(kind==='icon')set({brandIcon:data});if(kind==='background')set({customBackground:data,galleryBackground:''});}
  return <Modal onClose={onClose} className="settings-modal"><div className="panel-header"><div><span className="eyebrow">MAKE IT YOURS</span><h2>{t('你的樣子，你的空間','Your space, your style')}</h2></div><button className="icon-button" aria-label={t('關閉設定','Close settings')} onClick={onClose}><Icon name="close"/></button></div><div className="modal-body">
    {error&&<div className="error" role="alert">{error}</div>}{notice&&<div className="status" role="status">{notice}</div>}
    <section className="settings-section"><h3>{t('個人資料','Your profile')}</h3><div className="profile-edit"><button className="avatar large" onClick={()=>avatarRef.current?.click()} disabled={busy} aria-label={t('更換頭像','Change avatar')}>{user.avatar?<img src={user.avatar} alt=""/>:user.name.slice(0,1).toUpperCase()}</button><div className="field grow"><label htmlFor="profile-name">{t('顯示名稱','Display name')}</label><input id="profile-name" value={name} onChange={e=>setName(e.target.value)} maxLength={80}/><small className="muted">{user.email}</small></div><button className="button" disabled={busy||!name.trim()} onClick={()=>void saveProfile()}>{t('更新','Update')}</button></div><input ref={avatarRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)void chooseImage(f,'avatar');e.target.value='';}}/></section>
    <section className="settings-section"><h3>{t('語言與外觀','Language & appearance')}</h3><div className="settings-columns"><label className="field">{t('介面語言','Interface language')}<select value={preferences.lang} onChange={e=>set({lang:e.target.value as Lang})}><option value="zh-TW">繁體中文</option><option value="en">English</option></select></label><div className="field"><label>{t('顯示模式','Display mode')}</label><div className="segmented"><button className={preferences.theme==='light'?'active':''} onClick={()=>set({theme:'light'})}><Icon name="sun" size={16}/>{t('淺色','Light')}</button><button className={preferences.theme==='dark'?'active':''} onClick={()=>set({theme:'dark'})}><Icon name="moon" size={16}/>{t('深色','Dark')}</button></div></div></div><BackgroundGallery preferences={preferences} onChange={set}/><details className="procedural-backgrounds"><summary>{t('程序背景（低流量）','Procedural backgrounds (low data)')}</summary><h4>{t('背景收藏','Background collection')}</h4><p className="muted small-text">{t('10 款可重現的程序生成背景，並非 AI 生成圖片。','10 reproducible procedural backgrounds, not AI-generated images.')}</p><div className="background-grid">{backgroundNames.map((n,i)=><button key={i} className={`background-option bg-${i} ${preferences.background===i&&!preferences.customBackground&&!preferences.galleryBackground?'selected':''}`} onClick={()=>set({background:i,customBackground:'',galleryBackground:''})} aria-label={n[zh?0:1]} aria-pressed={preferences.background===i&&!preferences.customBackground&&!preferences.galleryBackground}><span>{n[zh?0:1]}</span>{preferences.background===i&&!preferences.customBackground&&!preferences.galleryBackground&&<Icon name="check" size={15}/>}</button>)}</div></details><label className="button upload-label"><Icon name="image" size={16}/>{t('使用自己的背景','Upload your background')}<input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)void chooseImage(f,'background');}}/></label>{preferences.customBackground&&<button className="button subtle" onClick={()=>set({customBackground:''})}>{t('移除自訂背景','Remove custom background')}</button>}</section>
    <section className="settings-section"><h3>{t('App 名稱與圖示','App name & icon')}</h3><div className="brand-edit"><div className="brand-icon preview">{preferences.brandIcon?<img src={preferences.brandIcon} alt=""/>:<Icon name="note" size={25}/>}</div><label className="field grow">{t('App 名稱','App name')}<input value={preferences.brandName} maxLength={40} placeholder={'抽獎NOTE'} onChange={e=>set({brandName:e.target.value})}/></label><label className="button upload-label">{t('自訂圖示','Choose icon')}<input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)void chooseImage(f,'icon');}}/></label></div><p className="muted small-text">{t('這些設定儲存在本機，只影響 App 內品牌、分頁標題與外觀。手機主畫面的名稱和圖示仍使用部署版本；需要管理者更新安裝資訊與圖示後，再由系統更新或重新安裝。只改這裡的設定再重新安裝，不會改變主畫面品牌。','These device preferences affect only in-app branding, the browser tab title and appearance. Home-screen branding uses the deployed installation settings and icons. An administrator must update those assets before the operating system can update or reinstall them. Reinstalling after changing only these preferences will not change home-screen branding.')}</p><button className="button subtle" onClick={()=>set({brandName:'',brandIcon:''})}>{t('恢復預設品牌','Reset branding')}</button></section>
    <section className="settings-section"><h3>{t('安裝到手機','Install on your phone')}</h3><p className="muted">{t('使用 HTTPS 開啟：iPhone 在 Safari 選「分享 → 加入主畫面」；Android 在瀏覽器選單選「安裝應用程式」。離線時可開啟 App 外殼，但筆記讀取與儲存需要連線。','Open over HTTPS: on iPhone, use Safari → Share → Add to Home Screen; on Android, use Install app from the browser menu. The app shell opens offline; reading and saving notes requires a connection.')}</p></section>
  </div></Modal>;
}
