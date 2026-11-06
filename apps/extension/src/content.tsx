import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const assets = {
  BTC: { name: 'Bitcoin', price: '$80,765.98', change: '+0.77%', mark: '₿', color: 'btc' },
  ETH: { name: 'Ethereum', price: '$2,336.87', change: '+1.24%', mark: '◆', color: 'eth' },
  SOL: { name: 'Solana', price: '$142.81', change: '+4.80%', mark: '◎', color: 'sol' },
  PEPE: { name: 'Pepe', price: '$0.0000096', change: '+2.40%', mark: '🐸', color: 'pepe' }
} as const;
type Symbol = keyof typeof assets;
type View = 'markets' | 'trade' | 'agent' | 'details' | 'create';

function Overlay() {
  const [expanded, setExpanded] = useState(false);
  const [quickView, setQuickView] = useState<View>('markets');
  const [token, setToken] = useState<{ symbol: Symbol; x: number; y: number } | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [wallet, setWallet] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    let hideTimer = 0;
    const move = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('#predidex-overlay')) return;
      const anchor = target?.closest('a') as HTMLElement | null;
      const match = anchor?.innerText.trim().match(/^\$(BTC|ETH|SOL|PEPE)$/i);
      if (!match) return;
      window.clearTimeout(hideTimer);
      const symbol = match[1].toUpperCase() as Symbol;
      const rect = anchor!.getBoundingClientRect();
      setToken({ symbol, x: Math.max(8, Math.min(rect.left, window.innerWidth - 440)), y: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 555)) });
    };
    const leave = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const next = event.relatedTarget as Node | null;
      if (target?.closest('a') && !host.contains(next)) hideTimer = window.setTimeout(() => setToken(current => current && !host.matches(':hover') ? null : current), 240);
    };
    document.addEventListener('mouseover', move);
    document.addEventListener('mouseout', leave);
    return () => { window.clearTimeout(hideTimer); document.removeEventListener('mouseover', move); document.removeEventListener('mouseout', leave); };
  }, []);

  const post = (symbol: string) => window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(`Will $${symbol} be above its current price at expiry? Create a prediction with Predictx. #Predictx`)}`, '_blank', 'noopener,noreferrer');
  const openView = (view: View) => { setQuickView(view); setExpanded(true); };
  const activeAsset = token ? assets[token.symbol] : assets.ETH;

  return <div className="overlay-layer">
    {token && <section className="hover-card" style={{ left: token.x, top: token.y }} aria-label={`${activeAsset.name} token preview`}>
      <header className="token-pop-head"><div className={`token-pop-logo ${activeAsset.color}`}>{activeAsset.mark}</div><div className="token-pop-title"><b>{activeAsset.name} <span>{token.symbol}</span></b><small><i>✓</i> Verified asset <span>·</span> Ethereum</small></div><button className="token-wallet-mini" onClick={() => setWalletOpen(true)} title="Connect wallet">⌑</button><button className="hover-close" aria-label="Close token card" onClick={() => setToken(null)}>×</button></header>
      <div className="token-price-row"><div><strong>{activeAsset.price}</strong><span className="token-change">{activeAsset.change} today</span></div><div className="token-metrics"><span>Market cap<b>$1.62T</b></span><span>24h volume<b>$23.87B</b></span></div></div>
      <div className="token-chart"><div className="chart-y-labels"><span>$81,500</span><span>$81,000</span><span>$80,500</span><span>$80,000</span></div><svg viewBox="0 0 370 138" preserveAspectRatio="none" aria-label="Sample price chart"><path d="M0 28H370M0 62H370M0 96H370M0 130H370"/><polyline points="0,110 12,102 18,119 28,95 38,108 50,79 62,90 75,70 88,82 102,60 113,73 128,53 138,66 151,49 166,59 179,45 191,63 204,39 216,54 230,43 242,56 254,29 267,48 280,20 294,35 306,24 318,39 332,17 345,29 356,42 370,34"/></svg><div className="chart-x-labels"><span>18:30</span><span>23:30</span><span>05:30</span><span>11:30</span><span>17:30</span></div></div>
      <div className="token-ranges"><button>1H</button><button className="selected">24H</button><button>7D</button><button>1M</button><span>Sample market data</span></div>
      <div className="token-actions"><button className="token-secondary" onClick={() => openView('details')}>View details <span>↗</span></button><button className="token-swap" onClick={() => openView('trade')}>Swap <span>⇄</span></button></div>
      <div className="token-bottom-actions"><button className="token-agent" onClick={() => openView('agent')}>✦ <span>Ask Predidex</span><b>Agent</b> ↗</button><button className="token-set-trade" onClick={() => openView('create')}>Set Trade</button></div>
      <button className="token-connect" onClick={() => setWalletOpen(true)}>{wallet ? `Connected · ${wallet}` : '⌑　Connect wallet'}</button>
    </section>}
    <button className="float-launcher" title="Open Predictx side panel" onClick={() => chrome.runtime.sendMessage({ type: 'open-side-panel' })}><img src={chrome.runtime.getURL('logo.svg')} alt="Open Predictx"/></button>
    {expanded && <aside className="quick-panel"><header><div className="brand"><img src={chrome.runtime.getURL('logo.svg')} alt=""/><div><strong>Predictx</strong><small>MARKETS ON X</small></div></div><button aria-label="Close panel" onClick={() => setExpanded(false)}>×</button></header><div className="quick-nav"><button className={quickView === 'markets' ? 'selected' : ''} onClick={() => setQuickView('markets')}>◉ Markets</button><button className={quickView === 'trade' ? 'selected' : ''} onClick={() => setQuickView('trade')}>⇄ Trade</button><button className={quickView === 'create' ? 'selected' : ''} onClick={() => setQuickView('create')}>＋ Create</button></div>
      {quickView === 'markets' && <div className="quick-content"><small className="quick-label">TRENDING POOLS</small>{[['₿','BTC','$68,000 in 4h?','58%'],['◆','ETH','$3,500 today?','64%'],['◎','SOL','$150 by Friday?','46%']].map(([icon,sym,q,yes])=><article key={sym}><div className="quick-coin">{icon}</div><div><b>{sym}</b><p>Will {sym} be above {q}</p><small>YES {yes}</small></div><button onClick={() => post(sym)}>Post ↗</button></article>)}<button className="quick-create" onClick={() => setQuickView('create')}>＋ Create a prediction</button></div>}
      {quickView === 'trade' && <div className="quick-content"><small className="quick-label">SWAP PREVIEW · BASE</small><div className="quick-swap-card"><label>You pay <b><input defaultValue="25" aria-label="USDC amount"/> USDC</b></label><label>Buy asset <b><select defaultValue={token?.symbol ?? 'ETH'} aria-label="Token"><option>ETH</option><option>BTC</option><option>SOL</option><option>PEPE</option></select></b></label><div className="quick-estimate">Estimated receive <b>Preview quote</b></div></div><p className="quick-foot">No wallet or transaction service is connected.</p><button className="quick-create" onClick={() => setWalletOpen(true)}>Connect wallet</button></div>}
      {quickView === 'agent' && <div className="quick-content"><small className="quick-label">PREDIDEX AGENT · TOKEN BRIEF</small><h2 className="preview-heading">{token?.symbol ?? 'ETH'} at a glance</h2><p className="agent-preview">I can help review price movement, liquidity, token distribution, and known risk signals. This design preview uses sample data and has no research service connected.</p><button className="quick-create" onClick={() => setNote('Agent responses are not connected in this UI preview.')}>Ask about {token?.symbol ?? 'ETH'}</button>{note && <p className="quick-note">{note}</p>}</div>}
      {quickView === 'details' && <div className="quick-content"><small className="quick-label">TOKEN OVERVIEW</small><h2 className="preview-heading">{activeAsset.name} ({token?.symbol})</h2><p className="agent-preview">Network: Ethereum · Contract and market details are sample interface content.</p><div className="quick-swap-card"><label>Market cap <b>$1.62T</b></label><label>24h volume <b>$23.87B</b></label><label>24h change <b>{activeAsset.change}</b></label></div></div>}
      {quickView === 'create' && <div className="quick-content"><small className="quick-label">SET TRADE · PREVIEW</small><div className="quick-swap-card"><label>Token <b>{token?.symbol ?? 'ETH'}</b></label><label>Target price <b><input defaultValue={activeAsset.price} aria-label="Target price"/></b></label><label>Direction <b><select aria-label="Direction"><option>Above</option><option>Below</option></select></b></label></div><p className="quick-foot">Set up a trade idea. This preview does not place trades.</p><button className="quick-create" onClick={() => setWalletOpen(true)}>Connect wallet to continue</button></div>}
      <div className="quick-foot bottom">Prices and actions are frontend previews only.</div></aside>}
    {walletOpen && <div className="wallet-backdrop" onClick={() => setWalletOpen(false)}><section className="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title" onClick={event => event.stopPropagation()}><button className="wallet-close" onClick={() => setWalletOpen(false)} aria-label="Close wallet picker">×</button><h2 id="wallet-title">Connect a wallet</h2><p>Choose a wallet to continue. Connection is a UI preview only.</p>{['MetaMask','Coinbase Wallet','Rabby','WalletConnect','Phantom'].map((name,index)=><button className="wallet-option" key={name} onClick={() => { setWallet(name); setWalletOpen(false); setNote(`${name} selected for this UI preview.`); }}><span>{['🦊','🔵','🟠','◈','◉'][index]}</span>{name}<b>↗</b></button>)}</section></div>}
  </div>;
}

const host = document.createElement('div');
host.id = 'predidex-overlay';
document.documentElement.appendChild(host);
chrome.storage.local.get({ showOverlay: true }).then(({ showOverlay }) => { host.hidden = !showOverlay; });
chrome.storage.onChanged.addListener(changes => { if (changes.showOverlay) host.hidden = changes.showOverlay.newValue === false; });
const shadow = host.attachShadow({ mode: 'open' });
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = chrome.runtime.getURL('content.css');
shadow.appendChild(link);
const root = document.createElement('div');
shadow.appendChild(root);
createRoot(root).render(<Overlay />);
