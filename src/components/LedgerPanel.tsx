import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { isLocalMode } from '../runtime';
import type { Ledger, Member } from '../types';
import { Icon } from './Icon';

type Props = { workspaceId: string; userId: string; role: string; lang: 'zh-TW' | 'en' };
type Confirmation = { id: string; fromId: string; toId: string; amount: number; status: 'pending' | 'confirmed'; createdAt: string; confirmedAt: string | null };
const emptyLedger: Ledger = { expenses: [], balances: [], settlements: [], currency: 'TWD' };

export function decimalToMinor(value: string): number | null {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const minor = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  return minor > 0n && minor <= 1_000_000_000n ? Number(minor) : null;
}

export default function LedgerPanel({ workspaceId, userId, role, lang }: Props) {
  const en = lang === 'en';
  const t = (zh: string, english: string) => en ? english : zh;
  const [ledger, setLedger] = useState<Ledger>(emptyLedger);
  const [members, setMembers] = useState<Member[]>([]);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [payerId, setPayerId] = useState(userId);
  const [participants, setParticipants] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const [live, setLive] = useState(false);
  const expenseId = useRef(crypto.randomUUID());
  const settlementIds = useRef<Record<string, string>>({});
  const initialized = useRef('');
  const canEdit = role !== 'viewer';
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}`;
  const money = (minor: number) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'TWD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
  const memberName = (id: string) => members.find(member => member.id === id)?.name || ledger.balances.find(balance => balance.userId === id)?.name || t('已離開的成員', 'Former member');

  useEffect(() => {
    let current = true;
    setError('');
    if (initialized.current !== workspaceId) {
      setLoading(true); setLedger(emptyLedger); setMembers([]); setConfirmations([]);
      setShowForm(false); setDescription(''); setAmount(''); setNotice('');
      expenseId.current = crypto.randomUUID(); settlementIds.current = {};
    }
    Promise.all([
      api<Ledger>(`/api/workspaces/${encodeURIComponent(workspaceId)}/expenses`),
      api<{ members: Member[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`),
      api<{ confirmations: Confirmation[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/settlements`),
    ]).then(([data, people, receipts]) => {
      if (!current) return;
      setLedger(data); setMembers(people.members); setConfirmations(receipts.confirmations);
      if (initialized.current !== workspaceId) {
        setParticipants(people.members.map(member => member.id));
        setPayerId(people.members.some(member => member.id === userId) ? userId : people.members[0]?.id || '');
        initialized.current = workspaceId;
      }
    }).catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : 'Unable to load ledger.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspaceId, userId, reload]);

  useEffect(() => {
    setLive(false);
    if (isLocalMode) {
      const changed = () => setReload(value => value + 1);
      window.addEventListener('luckynote:local-change', changed);
      return () => window.removeEventListener('luckynote:local-change', changed);
    }
    const stream = new EventSource(`/api/workspaces/${encodeURIComponent(workspaceId)}/events`);
    stream.onopen = () => setLive(true);
    stream.onerror = () => setLive(false);
    stream.onmessage = message => { try { const event = JSON.parse(message.data) as { kind: string }; if (event.kind === 'expenses' || event.kind === 'members') setReload(value => value + 1); } catch { /* Ignore malformed transport notices; no data is applied. */ } };
    return () => stream.close();
  }, [workspaceId]);

  function freshMutation() { expenseId.current = crypto.randomUUID(); setNotice(''); }
  async function addExpense(event: FormEvent) {
    event.preventDefault();
    if (busy || !canEdit) return;
    const minor = decimalToMinor(amount);
    if (minor === null) { setError(t('金額需大於 0，最多兩位小數，上限 NT$10,000,000。', 'Enter an amount above zero with up to two decimals, at most NT$10,000,000.')); return; }
    if (!description.trim() || !participants.length || !payerId) { setError(t('請填寫用途、付款人，並選取至少一位分攤成員。', 'Enter a description, a payer, and at least one participant.')); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`${base}/expenses`, { method: 'POST', body: JSON.stringify({ description: description.trim(), amount: minor, payerId, participantIds: participants, clientMutationId: expenseId.current }) });
      setDescription(''); setAmount(''); setShowForm(false); expenseId.current = crypto.randomUUID(); setReload(value => value + 1);
      setNotice(t('費用已記入帳本。沒有發起轉帳。', 'Expense recorded. No transfer was initiated.'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('費用新增失敗。', 'Could not record expense.')); }
    finally { setBusy(false); }
  }
  async function removeExpense(id: string, label: string) {
    if (busy || !canEdit || !window.confirm(t(`刪除「${label}」？這會重新計算所有分攤餘額。`, `Delete “${label}”? All split balances will be recalculated.`))) return;
    setBusy(true); setError(''); setNotice('');
    try { await api(`/api/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' }); setReload(value => value + 1); setNotice(t('已刪除費用並重新計算。', 'Expense deleted and balances recalculated.')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('刪除失敗。', 'Could not delete expense.')); }
    finally { setBusy(false); }
  }
  async function markPaid(toId: string, minor: number) {
    if (busy || !canEdit || !window.confirm(t(`只有在你已透過其他方式支付 ${money(minor)} 給 ${memberName(toId)} 時，才建立這筆確認紀錄。此 App 不會轉帳。是否繼續？`, `Create this record only if you already paid ${money(minor)} to ${memberName(toId)} outside this app. This app does not transfer funds. Continue?`))) return;
    setBusy(true); setError(''); setNotice('');
    const key = `${toId}:${minor}`;
    const mutation = settlementIds.current[key] || (settlementIds.current[key] = crypto.randomUUID());
    try {
      const result = await api<{ id: string; status: 'pending' }>(`${base}/settlements`, { method: 'POST', body: JSON.stringify({ toId, amount: minor, clientMutationId: mutation }) });
      setConfirmations(previous => previous.some(item => item.id === result.id) ? previous : [{ id: result.id, fromId: userId, toId, amount: minor, status: 'pending', createdAt: new Date().toISOString(), confirmedAt: null }, ...previous]);
      delete settlementIds.current[key];
      setReload(value => value + 1); setNotice(t('已建立待收款人確認的紀錄，餘額暫不變動。', 'Awaiting recipient confirmation. Balances have not changed.'));
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('建立確認紀錄失敗。', 'Could not create confirmation.')); }
    finally { setBusy(false); }
  }
  async function confirmReceipt(item: Confirmation) {
    if (busy || !canEdit || !window.confirm(t(`確認你已實際收到 ${memberName(item.fromId)} 的 ${money(item.amount)}？確認後會更新帳本餘額。`, `Have you actually received ${money(item.amount)} from ${memberName(item.fromId)}? Confirming updates ledger balances.`))) return;
    setBusy(true); setError(''); setNotice('');
    try { await api(`${base}/settlements/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'confirmed' }) }); setReload(value => value + 1); setNotice(t('已確認收款並更新分攤餘額。', 'Receipt confirmed and balances updated.')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('確認收款失敗。', 'Could not confirm receipt.')); }
    finally { setBusy(false); }
  }

  const total = ledger.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const net = ledger.balances.reduce((sum, balance) => sum + balance.balance, 0);
  const personal = ledger.balances.find(balance => balance.userId === userId)?.balance || 0;

  return <section className="ledger-panel" aria-label={t('分帳帳本', 'Shared expense ledger')}>
    <div className="row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}><div><span className="eyebrow">SPLIT, TOGETHER</span><h1>{t('一起記帳，輕鬆分攤', 'Shared moments. Fair splits.')}</h1><p className="muted">{t('記下共同支出，讓每一分錢都有清楚的去向。', 'Keep shared expenses clear, down to the last cent.')}</p></div>{canEdit && <button className="button primary" onClick={() => { setShowForm(value => !value); setError(''); }} disabled={busy}><Icon name={showForm ? 'close' : 'plus'} />{showForm ? t('取消新增', 'Cancel') : t('新增費用', 'Add expense')}</button>}</div>
    <p className="muted" style={{ fontSize: 12 }}>{isLocalMode ? t('此裝置費用紀錄 · 沒有群組或伺服器同步', 'Device expense records · no group or server sync') : live ? t('即時同步已連線', 'Live sync connected') : t('同步連線中，可手動重新整理', 'Connecting to sync; refresh is available')} · <button className="button" onClick={() => setReload(value => value + 1)} disabled={busy || loading} style={{ padding: '3px 8px', fontSize: 12 }}>{t('重新整理', 'Refresh')}</button></p>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="status" role="status">{notice}</p>}
    {loading ? <p role="status" className="muted">{t('正在讀取帳本…', 'Loading ledger…')}</p> : <>
      <div className="stat-grid"><div className="stat-card"><span className="muted">{t('共同支出', 'Shared expenses')}</span><strong>{money(total)}</strong><small>{ledger.expenses.length} {t('筆紀錄', 'entries')}</small></div><div className="stat-card"><span className="muted">{personal >= 0 ? t('你待收款', 'You are owed') : t('你待支付', 'You owe')}</span><strong>{money(Math.abs(personal))}</strong><small>{t('已計入收款人確認的結清紀錄', 'Includes recipient-confirmed settlements')}</small></div><div className="stat-card"><span className="muted">{t('餘額核對', 'Balance check')}</span><strong>{net === 0 ? t('總額守恆', 'Balanced') : t('需要核對', 'Review needed')}</strong><small>{t('全部成員餘額合計', 'Sum of member balances')} {money(net)}</small></div></div>
      {net !== 0 && <p className="error" role="alert">{t('帳本餘額合計不為零，請先重新整理並核對資料，不要依此結清。', 'Member balances do not sum to zero. Refresh and review before settling.')}</p>}
      {showForm && <form onSubmit={event => void addExpense(event)} style={{ border: '1px solid var(--line, #dce3de)', padding: 22, borderRadius: 18, margin: '20px 0' }}>
        <h2>{t('新增共同支出', 'Record a shared expense')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 16 }}>
          <label className="field">{t('用途', 'Description')}<input value={description} maxLength={200} required onChange={e => { setDescription(e.target.value); freshMutation(); }} placeholder={t('例如：晚餐、住宿、車票', 'Dinner, accommodation, train tickets…')} disabled={busy} /></label>
          <label className="field">{t('金額（新台幣）', 'Amount (TWD)')}<input value={amount} inputMode="decimal" onChange={e => { setAmount(e.target.value); freshMutation(); }} placeholder="0.00" required aria-describedby="money-explanation" disabled={busy} /></label>
          <label className="field">{t('誰先支付', 'Paid by')}<select value={payerId} onChange={e => { setPayerId(e.target.value); freshMutation(); }} disabled={busy}>{members.map(member => <option key={member.id} value={member.id}>{member.name}{member.id === userId ? t('（你）', ' (you)') : ''}</option>)}</select></label>
        </div>
        <fieldset style={{ border: 'none', padding: 0, margin: '18px 0' }} disabled={busy}><legend style={{ marginBottom: 10 }}>{t('平均分攤給', 'Split equally among')}</legend><div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>{members.map(member => <label key={member.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={participants.includes(member.id)} onChange={e => { setParticipants(previous => e.target.checked ? [...previous, member.id] : previous.filter(id => id !== member.id)); freshMutation(); }} />{member.name}</label>)}</div></fieldset>
        <p id="money-explanation" className="muted" style={{ fontSize: 12 }}>{t('最多兩位小數，以整數「分」計算；不能均分的餘數依固定成員 ID 順序分配，合計一定等於原金額。', 'Up to two decimal places, calculated as integer cents. Remainders follow a deterministic member-ID order, preserving the exact total.')}</p>
        <div className="row" style={{ display: 'flex', gap: 10 }}><button type="submit" className="button primary" disabled={busy || !participants.length}>{busy ? t('儲存中…', 'Saving…') : t('儲存費用', 'Save expense')}</button><button type="button" className="button" onClick={() => setShowForm(false)} disabled={busy}>{t('取消', 'Cancel')}</button></div>
      </form>}
      {!ledger.expenses.length ? <div style={{ textAlign: 'center', padding: '54px 24px', border: '1px dashed var(--line, #dce3de)', borderRadius: 18, margin: '24px 0' }}><Icon name="wallet" size={42} /><h2>{t('共同回憶，從第一筆開始', 'Start with your first shared expense')}</h2><p className="muted">{t('新增一筆費用，選擇付款人和分攤成員。所有資料只在目前工作空間內分享。', 'Add an expense, choose the payer, and select participants. Entries are shared only within this workspace.')}</p></div> : <div style={{ overflowX: 'auto', marginTop: 24 }}><table className="data-table" style={{ width: '100%' }}><caption style={{ textAlign: 'left', fontWeight: 700, marginBottom: 14 }}>{t('支出明細', 'Expense entries')}</caption><thead><tr><th>{t('用途 / 日期', 'Description / date')}</th><th>{t('付款人', 'Payer')}</th><th>{t('分攤人數', 'People')}</th><th>{t('金額', 'Amount')}</th>{canEdit && <th><span className="sr-only">{t('操作', 'Actions')}</span></th>}</tr></thead><tbody>{ledger.expenses.map(expense => <tr key={expense.id}><td><strong>{expense.description}</strong><br /><small className="muted">{new Date(expense.createdAt).toLocaleDateString(lang)}</small></td><td>{memberName(expense.payerId)}</td><td>{expense.participantIds.length}</td><td style={{ whiteSpace: 'nowrap' }}>{money(expense.amount)}</td>{canEdit && <td><button className="button icon-button" disabled={busy} onClick={() => void removeExpense(expense.id, expense.description)} aria-label={t(`刪除費用 ${expense.description}`, `Delete expense ${expense.description}`)}><Icon name="trash" size={16} /></button></td>}</tr>)}</tbody></table></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 270px), 1fr))', gap: 24, marginTop: 30 }}>
        <section style={{ border: '1px solid var(--line, #dce3de)', borderRadius: 18, padding: 22 }}><h2 style={{ fontSize: 18 }}>{t('每人餘額', 'Member balances')}</h2>{ledger.balances.map(balance => <div className="row" key={balance.userId} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', gap: 12, borderBottom: '1px solid var(--line, #dce3de)' }}><span>{balance.name}{balance.userId === userId ? t('（你）', ' (you)') : ''}</span><div style={{ textAlign: 'right' }}><strong>{money(Math.abs(balance.balance))}</strong><br /><small className="muted">{balance.balance > 0 ? t('待收款', 'To receive') : balance.balance < 0 ? t('待支付', 'To pay') : t('已平衡', 'Even')}</small></div></div>)}</section>
        <section style={{ border: '1px solid var(--line, #dce3de)', borderRadius: 18, padding: 22 }}><h2 style={{ fontSize: 18 }}>{t('結清建議', 'Settlement suggestions')}</h2><p className="muted" style={{ fontSize: 13 }}>{t('請自行使用現金或官方支付工具結清。本 App 不轉帳、不保管資金；下方只登記付款事實。', 'Settle outside this app with cash or an official payment app. We do not transfer or hold money. The actions below only record completed payments.')}</p>{!ledger.settlements.length && <p className="status">{t('目前沒有需要結清的款項。', 'No outstanding settlements.')}</p>}{ledger.settlements.map((item, index) => {
          const pending = confirmations.some(record => record.status === 'pending' && record.fromId === item.from && record.toId === item.to && record.amount === item.amount);
          return <div key={`${item.from}:${item.to}:${index}`} style={{ padding: '14px 0', borderTop: '1px solid var(--line, #dce3de)' }}><div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}><span>{memberName(item.from)} → {memberName(item.to)}</span><strong>{money(item.amount)}</strong></div>{item.from === userId && canEdit && <button className="button" disabled={busy || pending || net !== 0} onClick={() => void markPaid(item.to, item.amount)} style={{ marginTop: 10, fontSize: 12 }}>{pending ? t('等待收款人確認', 'Awaiting recipient') : t('已自行支付，登記待確認', 'I paid externally · record it')}</button>}</div>;
        })}</section>
      </div>
      {!!confirmations.length && <section style={{ marginTop: 28 }}><h2>{t('人工結清確認', 'Manual settlement confirmations')}</h2>{confirmations.map(item => <div key={item.id} className="row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '16px 0', borderBottom: '1px solid var(--line, #dce3de)' }}><div><strong>{memberName(item.fromId)} → {memberName(item.toId)} · {money(item.amount)}</strong><p className="muted" style={{ margin: '5px 0 0', fontSize: 12 }}>{item.status === 'confirmed' ? t('收款人已確認，已計入餘額', 'Recipient confirmed; included in balances') : t('待收款人確認，尚未影響餘額', 'Awaiting recipient; balances unchanged')} · {new Date(item.createdAt).toLocaleDateString(lang)}</p></div>{item.status === 'pending' && item.toId === userId && canEdit && <button className="button primary" disabled={busy} onClick={() => void confirmReceipt(item)}>{t('確認已收到款項', 'Confirm received')}</button>}</div>)}</section>}
    </>}
  </section>;
}
