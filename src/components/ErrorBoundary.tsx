import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return{failed:true};}
  render(){
    if(!this.state.failed)return this.props.children;
    const en=document.documentElement.lang==='en';
    return <main className="loading-screen" role="alert"><h1>{en?'Something interrupted your workspace':'工作空間遇到意外錯誤'}</h1><p className="muted">{en?'Please reload to reconnect. Changes that were not saved may need to be entered again.':'請重新載入以連線。尚未儲存的修改可能需要重新輸入。'}</p><button className="button primary" onClick={()=>window.location.reload()}>{en?'Reload workspace':'重新載入工作空間'}</button></main>;
  }
}
