import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Section = 'chat' | 'markets' | 'trade' | 'history' | 'settings';
type AssetTab = 'Chart' | 'Sentiment' | 'News' | 'On-chain';

const marketRows = [
  { symbol: 'BTC', question: 'above $68,000 in 4h?', odds: '58%', color: 'amber' },
  { symbol: 'ETH', question: 'above $3,500 today?', odds: '64%', color: 'violet' },
  { symbol: 'SOL', question: 'above $150 by Friday?', odds: '46%', color: 'cyan' }
];

function App() {
  const [section, setSection] = useState<Section>('chat');
  const [tab, setTab] = useState<AssetTab>('Chart');
  const [range, setRange] = useState('1D');
  const [comparisons, setComparisons] = useState({ ETH: true, BTC: false });
  const [amount, setAmount] = useState('25');
  const [message, setMessage] = useState('');
  const [overlayEnabled, setOverlayEnabled] = useState(true);

  useEffect(() => {
    chrome.storage.local.get({ showOverlay: true }).then(({ showOverlay }) => setOverlayEnabled(showOverlay));
  }, []);

  const tweet = (text: string) => window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  const nav = (view: Section) => { setSection(view); setMessage(''); };

  return <main className="app-shell">
    <div className="workspace">
      <section className="main-column">
        <header className="topbar">
          <div className="brand"><img src="/logo.svg" alt=""/><div><strong>Predictx</strong><small>MARKETS ON X</small></div></div>
          <div className="top-actions"><span className="network-chip"><i/>Base Sepolia</span><button className="icon-button" aria-label="Open X" onClick={() => window.open('https://x.com', '_blank', 'noopener,noreferrer')}>↗</button></div>
        </header>

        <div className="conversation-head">
          <button className="conversation-title" onClick={() => nav('chat')}>Risk and reward of SOL at $130</button>
          <button className="tiny-action" aria-label="Save chat">☆</button>
          <button className="tiny-action" aria-label="Share chat" onClick={() => tweet('Researching Solana on Predictx — join the conversation on X.')}>↥</button>
        </div>

        {section === 'chat' && <div className="scroll-area">
          <div className="user-query"><span>YOU</span><p>What's the risk and reward ratio of buying Solana at $130?</p></div>
          <div className="research-status"><span className="status-pulse"/> Research preview <i/> <span>4 sources</span></div>
          <p className="answer-copy">At a $130 entry, SOL would be below the current sample price. That gap shows a possible upside scenario, not a forecast. Volatility and a break in the underlying thesis remain the key risks.</p>

          <article className="asset-card">
            <div className="data-stamp">SAMPLE MARKET SNAPSHOT <span>·</span> 12:42 UTC</div>
            <div className="asset-identity"><div className="asset-logo sol">◎</div><div className="asset-name"><strong>Solana <span>SOL</span></strong><small>Solana network <button aria-label="Copy contract">⧉</button></small></div><button className="asset-more" aria-label="More asset links">↗</button></div>
            <div className="asset-links"><span>Website</span><span>𝕏</span><span>Explorer</span><span>↗</span></div>
            <div className="asset-tabs" role="tablist" aria-label="Asset analysis">{(['Chart', 'Sentiment', 'News', 'On-chain'] as AssetTab[]).map(item => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
            {tab === 'Chart' && <>
              <div className="price-line"><strong>$142.81</strong><span className="positive">+4.8% <i>↗</i></span><small>24h</small></div>
              <div className="chart-controls">{['1D', '1W', '1M'].map(item => <button className={range === item ? 'selected' : ''} key={item} onClick={() => setRange(item)}>{item}</button>)}<button className="trend-filter">Trending view⌄</button></div>
              <div className="chart-wrap"><svg viewBox="0 0 270 108" preserveAspectRatio="none" role="img" aria-label={`${range} sample price chart for Solana`}>
                <path className="grid-line" d="M0 12H270M0 39H270M0 66H270M0 93H270"/><text x="2" y="10">$148</text><text x="2" y="37">$144</text><text x="2" y="64">$140</text><text x="2" y="91">$136</text>
                {comparisons.BTC && <polyline className="chart-btc" points="24,75 48,73 72,77 96,64 120,69 144,59 168,61 192,55 216,58 240,49 266,52"/>}
                {comparisons.ETH && <polyline className="chart-eth" points="24,78 48,72 72,74 96,68 120,74 144,60 168,65 192,53 216,58 240,47 266,42"/>}
                <polyline className="chart-sol" points="24,84 48,78 72,81 96,58 120,64 144,54 168,61 192,40 216,48 240,34 266,27"/>
                <circle cx="266" cy="27" r="3" className="chart-dot"/><text x="24" y="106">06:00</text><text x="102" y="106">10:00</text><text x="182" y="106">14:00</text><text x="244" y="106">18:00</text>
              </svg></div>
              <div className="comparison-row"><span>Compare</span>{(['ETH', 'BTC'] as const).map(symbol => <label key={symbol}><input type="checkbox" checked={comparisons[symbol]} onChange={e => setComparisons(v => ({ ...v, [symbol]: e.target.checked }))}/><i className={`legend ${symbol.toLowerCase()}`}/>{symbol}</label>)}</div>
            </>}
            {tab === 'Sentiment' && <div className="tab-panel"><div className="sentiment-score"><strong>68</strong><span>Mostly positive<small>Social sentiment · sample</small></span></div><div className="sentiment-bar"><i/></div><div className="sentiment-legend"><span>Positive <b>68%</b></span><span>Negative <b>32%</b></span></div><p>Discussion is up this week, with ecosystem activity among the most mentioned themes.</p></div>}
            {tab === 'News' && <div className="tab-panel news-list"><article><small>COINDESK <i>·</i> 2H AGO</small><b>Solana ecosystem activity rises as network usage grows</b><p>Recent activity points to continued interest across the ecosystem.</p></article><article><small>THE BLOCK <i>·</i> 5H AGO</small><b>Developers discuss the next network update</b><p>Read the original source before making a decision.</p></article></div>}
            {tab === 'On-chain' && <div className="tab-panel chain-grid"><div><small>ACTIVE ADDRESSES</small><b>1.42m</b><i>+6.2% 7d</i></div><div><small>TX / 24H</small><b>42.8m</b><i>+2.1% 7d</i></div><div><small>NETWORK FEES</small><b>$0.003</b><i>Sample metric</i></div><div><small>SUPPLY STAKED</small><b>68.4%</b><i>Sample metric</i></div></div>}
            <div className="card-credit">Data shown for interface preview <span>↗</span></div>
          </article>
          <div className="followup"><span className="assistant-mark"><img src="/logo.svg" alt=""/></span><button onClick={() => setMessage('Follow-up research is a design preview; no AI service is connected.')}>Ask a follow-up about SOL…</button><span>↵</span></div>
        </div>}

        {section === 'markets' && <div className="scroll-area page-view"><div className="page-title"><span>COMMUNITY</span><h1>Prediction markets</h1><p>Pick a side. Share it on X.</p></div>{marketRows.map(row => <article className="market-row" key={row.symbol}><div className={`market-symbol ${row.color}`}>{row.symbol === 'BTC' ? '₿' : row.symbol === 'ETH' ? '◆' : '◎'}</div><div className="market-copy"><b>{row.symbol} <small>4H</small></b><p>Will {row.symbol} be {row.question}</p><span>YES {row.odds} <i>·</i> Sample market</span></div><button className="market-share" aria-label={`Post ${row.symbol} market on X`} onClick={() => tweet(`Will $${row.symbol} be ${row.question} Predict with me on Predictx. #Predictx`)}>↗</button></article>)}<button className="subtle-button" onClick={() => nav('trade')}>Explore markets <span>→</span></button></div>}

        {section === 'trade' && <div className="scroll-area page-view"><div className="page-title"><span>SWAP & PREDICT</span><h1>Trade</h1><p>Preview a swap on Base.</p></div><div className="side-toggle"><button className="selected">Buy</button><button>Sell</button></div><div className="trade-box"><label>You pay <b><input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal"/> USDC</b></label><label>Buy asset <b><select defaultValue="SOL"><option>SOL</option><option>ETH</option><option>BTC</option></select></b></label></div><div className="trade-estimate"><span>Estimated receive</span><b>≈ 0.175 SOL</b></div><div className="preview-note">Wallet and trade execution are not connected in this UI preview.</div><button className="primary-action" onClick={() => setMessage('Wallet connection is not configured in this UI preview.')}>Connect wallet</button></div>}

        {section === 'history' && <div className="scroll-area page-view"><div className="page-title"><span>YOUR WORKSPACE</span><h1>Recent chats</h1><p>Pick up where you left off.</p></div>{[['Today', 'Risk and reward of SOL at $130'], ['Yesterday', 'ETH market sentiment this week'], ['Oct 24', 'BTC support levels to watch']].map(([date, title]) => <button className="history-row" key={title} onClick={() => nav('chat')}><small>{date}</small><span>{title}</span><b>›</b></button>)}</div>}

        {section === 'settings' && <div className="scroll-area page-view"><div className="page-title"><span>PREFERENCES</span><h1>Extension settings</h1><p>Choose how Predictx appears on X.</p></div><div className="settings-card"><div><b>Show overlay on X</b><p>Display the Predictx mark and cashtag card on x.com.</p></div><input type="checkbox" checked={overlayEnabled} aria-label="Show overlay on X" onChange={e => { const enabled = e.target.checked; setOverlayEnabled(enabled); chrome.storage.local.set({ showOverlay: enabled }); }}/></div><div className="settings-card"><div><b>Open Chrome side panel</b><p>Click the Predictx mark on X or the toolbar button to open this workspace.</p></div><span className="settings-on">ON</span></div><div className="settings-foot">Pin Predictx from Chrome’s Extensions menu for quick access.</div></div>}

        {message && <div className="inline-message" role="status">{message}<button onClick={() => setMessage('')} aria-label="Dismiss">×</button></div>}
        <form className="composer" onSubmit={e => { e.preventDefault(); setMessage('Follow-up research is a design preview; no AI service is connected.'); }}><input placeholder="Ask me anything about crypto…" aria-label="Ask a question"/><button type="submit" aria-label="Send question">↗</button></form>
      </section>

      <nav className="nav-rail" aria-label="Predictx sections">
        <div className="rail-main"><button className={section === 'chat' ? 'active' : ''} onClick={() => nav('chat')}><span>◌</span><small>Chat</small></button><button className={section === 'markets' ? 'active' : ''} onClick={() => nav('markets')}><span>◉</span><small>Markets</small></button><button className={section === 'trade' ? 'active' : ''} onClick={() => nav('trade')}><span>⇄</span><small>Trade</small></button><button className={section === 'history' ? 'active' : ''} onClick={() => nav('history')}><span>◷</span><small>History</small></button></div>
        <div className="rail-bottom"><button className={section === 'settings' ? 'active' : ''} onClick={() => nav('settings')} aria-label="Settings"><span>⚙</span></button><div className="avatar">P</div></div>
      </nav>
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);


