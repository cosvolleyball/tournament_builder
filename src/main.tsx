import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check,
  CheckCircle2, ChevronRight, ClipboardList, Copy, ExternalLink, Flag,
  GitBranch, LayoutDashboard, ListChecks, LockKeyhole, Medal, Menu, Plus,
  RefreshCw, Save, ShieldCheck, Shuffle, Sparkles, Swords, Trophy,
  UsersRound, Volleyball, X,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import type { Match, NewTournamentInput, Pool, SetScore, Tournament, TournamentBundle } from './types';
import { createBundle, scoreError, standingsForPool } from './engine';
import { changeStatus, createTournament, deleteTournament, demoMode, getTournament, listTournaments, submitScore, supabase } from './repository';
import './style.css';

type Screen = 'home' | 'new' | 'detail';
type DetailTab = 'overview' | 'pools' | 'playoffs';
const sampleTeams = Array.from({ length: 16 }, (_, i) => `Team ${i + 1}`);
const today = new Date().toISOString().slice(0, 10);
const blankInput: NewTournamentInput = {
  name: '', sport: 'Volleyball', startsOn: today, teamNames: [], poolCount: 4,
  poolSets: 2, targetPoints: 21, winByTwo: true, seedMode: 'snake',
  goldFormat: 'double', silverFormat: 'single', bracketReset: true,
};
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const statusLabel = (status: string) => status === 'pool_play' ? 'Pool play active' : titleCase(status);
const randomExampleDate = () => new Date(Date.now() + 86400 * 1000 * 7).toISOString().slice(0, 10);

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(demoMode);
  const [screen, setScreen] = useState<Screen>(new URLSearchParams(window.location.search).has('t') ? 'detail' : 'home');
  const [activeId, setActiveId] = useState(new URLSearchParams(window.location.search).get('t'));
  const [records, setRecords] = useState<Tournament[]>([]);
  const [bundle, setBundle] = useState<TournamentBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const owner = demoMode || !!(session?.user.id && bundle && session.user.id === bundle.tournament.owner_id);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data, error: authError }) => {
      if (authError) setError(authError.message);
      setSession(data.session); setAuthChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession); setAuthChecked(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    listTournaments(session?.user.id ?? null).then(setRecords).catch(e => setError(String(e.message ?? e)));
  }, [session, authChecked]);

  useEffect(() => {
    if (!activeId || screen !== 'detail') return;
    setLoading(true); setError('');
    getTournament(activeId).then(setBundle).catch(e => setError(String(e.message ?? e))).finally(() => setLoading(false));
  }, [activeId, screen]);

  useEffect(() => {
    const handler = () => {
      const id = new URLSearchParams(window.location.search).get('t');
      setActiveId(id); setScreen(id ? 'detail' : 'home');
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const navigate = (where: Screen, id: string | null = null) => {
    if (where === 'new' && !demoMode && !session) { setToast('Sign in to create a tournament.'); return; }
    const url = id ? `?t=${encodeURIComponent(id)}` : window.location.pathname;
    window.history.pushState(null, '', url);
    setScreen(where); setActiveId(id); setMobileMenu(false); setError('');
  };
  const reload = async (id: string) => {
    const [next, summaries] = await Promise.all([getTournament(id), listTournaments(session?.user.id ?? null)]);
    setBundle(next); setRecords(summaries);
  };
  const perform = async (fn: () => Promise<void>, success: string) => {
    setLoading(true); setError('');
    try { await fn(); setToast(success); }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setLoading(false); }
  };
  const handleCreate = async (input: NewTournamentInput) => {
    const created = createBundle(input);
    await perform(async () => {
      await createTournament(created, session?.user.id ?? null);
      setRecords(await listTournaments(session?.user.id ?? null));
      navigate('detail', created.tournament.id);
    }, 'Tournament created successfully.');
  };
  const handleStatus = async (status: 'published' | 'pool_play') => {
    if (!bundle) return;
    await perform(async () => { await changeStatus(bundle.tournament.id, status); await reload(bundle.tournament.id); },
      status === 'published' ? 'Tournament published.' : 'Pool play started.');
  };
  const handleScore = async (match: Match, pairs: Array<[number, number]>) => {
    if (!bundle) return;
    const reason = scoreError(pairs, bundle.tournament.pool_sets, bundle.tournament.target_points, bundle.tournament.win_by_two);
    if (reason) throw new Error(reason);
    const scores: SetScore[] = pairs.map(([score_a, score_b], i) => ({ match_id: match.id, set_number: i + 1, score_a, score_b }));
    setLoading(true);
    try {
      await submitScore(bundle.tournament.id, match.id, scores);
      await reload(bundle.tournament.id);
      setToast('Score saved and standings updated.');
    } finally { setLoading(false); }
  };
  const signIn = async () => {
    setError('');
    const { error: authError } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (authError) setError(authError.message);
  };
  const handleDelete = async () => {
    if (!bundle || !window.confirm(`Permanently delete “${bundle.tournament.name}”? This cannot be undone.`)) return;
    await perform(async () => {
      await deleteTournament(bundle.tournament.id);
      setRecords(await listTournaments(session?.user.id ?? null));
      setBundle(null); navigate('home');
    }, 'Tournament deleted.');
  };
  const showHome = screen === 'home';
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
        <div className="brand" onClick={() => navigate('home')} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') navigate('home'); }}>
          <span className="brand-icon"><Trophy size={23} strokeWidth={2.2}/></span>
          <span className="brand-words"><strong>Tournament<span>Builder</span></strong><small>THE ORGANIZER'S HUB</small></span>
        </div>
        <div className="sidebar-content">
          <div className="sidebar-label">WORKSPACE</div>
          <button className={`side-link ${showHome ? 'selected' : ''}`} onClick={() => navigate('home')}><LayoutDashboard size={18}/> Dashboard</button>
          <button className={`side-link ${screen === 'new' ? 'selected' : ''}`} onClick={() => navigate('new')}><Plus size={19}/> New tournament</button>
          <div className="sidebar-label space-above">YOUR TOURNAMENTS</div>
          {records.length ? records.slice(0, 7).map(t => (
            <button key={t.id} className={`side-link tournament-link ${activeId === t.id ? 'selected' : ''}`} onClick={() => navigate('detail', t.id)}>
              <span className="mini-dot"/> <span className="truncate">{t.name}</span>
            </button>
          )) : <div className="sidebar-empty">Your tournaments will appear here.</div>}
        </div>
        <div className="sidebar-footer">
          <div className="footer-badge"><ShieldCheck size={16}/><span>{demoMode ? 'LOCAL DEMO MODE' : 'SUPABASE CONNECTED'}</span></div>
          <p>{demoMode ? 'Data is saved only in this browser.' : 'Protected by database access policies.'}</p>
          <div className="footer-bottom"><span>BUILD 0.1 · FOUNDATION</span><GitBranch size={17}/></div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileMenu(v => !v)} aria-label="Open menu"><Menu size={21}/></button>
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={15}/><strong>{screen === 'new' ? 'New tournament' : screen === 'detail' ? (bundle?.tournament.name ?? 'Tournament') : 'Overview'}</strong></div>
          <div className="topbar-actions">
            {demoMode ? <span className="mode-pill"><span className="online-dot"/> Demo workspace</span> : !session ? <button className="button button-outline small" onClick={signIn}>Sign in with Google</button>
              : <button className="account-button" onClick={() => supabase!.auth.signOut()} title="Sign out"><span className="avatar">{(session.user.email?.[0] ?? 'U').toUpperCase()}</span><span className="account-email">{session.user.email}</span><span className="signout-label">Sign out</span></button>}
          </div>
        </header>
        <div className="content">
          {error && <div className="error-alert" role="alert"><strong>Something needs attention</strong><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
          {!authChecked ? <div className="center-message">Checking your session…</div>
            : screen === 'home' ? <Dashboard records={records} onNew={() => navigate('new')} onOpen={id => navigate('detail', id)} isSignedIn={demoMode || !!session} signIn={signIn}/>
            : screen === 'new' ? <NewWizard onBack={() => navigate('home')} onCreate={handleCreate} busy={loading}/>
            : loading && !bundle ? <div className="center-message">Loading tournament…</div>
            : bundle && activeId === bundle.tournament.id ? <TournamentPage bundle={bundle} isOwner={owner} busy={loading} onBack={() => navigate('home')} onStatus={handleStatus} onScore={handleScore} onDelete={handleDelete}/>
            : <div className="center-message">Tournament not found or not accessible. <button className="text-link" onClick={() => navigate('home')}>Back to dashboard</button></div>}
        </div>
      </main>
      {toast && <div className="toast" role="status"><CheckCircle2 size={18}/>{toast}</div>}
    </div>
  );
}

function Dashboard({ records, onNew, onOpen, isSignedIn, signIn }: {
  records: Tournament[]; onNew: () => void; onOpen: (id: string) => void; isSignedIn: boolean; signIn: () => void;
}) {
  return (
    <div className="page-enter">
      <div className="welcome-line"><span className="eyebrow">TOURNAMENT MANAGEMENT, SIMPLIFIED</span></div>
      <div className="page-heading"><div><h1>Run the game.<br/><span>We'll handle the rest.</span></h1><p>From the first pool match to the final point. All your tournaments, all in one place.</p></div>
        <button className="button button-primary heading-cta" onClick={isSignedIn ? onNew : signIn}>{isSignedIn ? <><Plus size={17}/> Create tournament</> : 'Get started with Google'}<ArrowRight size={17}/></button>
      </div>
      <div className="metrics-grid">
        <Metric icon={<Trophy size={20}/>} label="My tournaments" value={records.length.toString()} hint="All formats"/>
        <Metric icon={<Flag size={20}/>} label="In progress" value={records.filter(t => ['published','pool_play','playoffs'].includes(t.status)).length.toString()} hint="Active competitions"/>
        <Metric icon={<CalendarDays size={20}/>} label="Upcoming" value={records.filter(t => !!t.starts_on && t.starts_on >= today).length.toString()} hint="Scheduled events"/>
      </div>
      <div className="section-heading"><div><h2>Your tournaments</h2><p>Pick up where you left off or build something new.</p></div><span>{records.length} total</span></div>
      {records.length ? <div className="tournament-grid">{records.map(record => <button key={record.id} className="t-card" onClick={() => onOpen(record.id)}>
        <div className="t-card-top"><div className="t-icon"><Volleyball size={24}/></div><span className={`status-tag ${record.status === 'draft' ? 'muted' : 'live'}`}>{statusLabel(record.status)}</span></div>
        <h3>{record.name}</h3><div className="t-card-meta"><span><CalendarDays size={15}/>{record.starts_on ?? 'Date not set'}</span><span><UsersRound size={15}/>{record.pool_count} pools</span></div>
        <div className="t-card-bottom"><span>{record.sport} · {record.pool_sets} set{record.pool_sets !== 1 ? 's' : ''} per matchup</span><ArrowUpRight size={18}/></div>
      </button>)}</div> : <div className="empty-state"><div className="empty-art"><Trophy size={40} strokeWidth={1.5}/><div className="empty-orbit"/></div>
        <h3>Your next great tournament starts here.</h3><p>Set up teams, organize pools, and track live scores without spreadsheets.</p>
        <button className="button button-primary" onClick={isSignedIn ? onNew : signIn}>{isSignedIn ? 'Create your first tournament' : 'Sign in to get started'}<ArrowRight size={17}/></button>
      </div>}
      <div className="feature-note"><div className="note-icon"><Sparkles size={22}/></div><div><strong>Built for volleyball. Ready for more.</strong><p>Flexible pool formats, automatic standings, and independent Gold and Silver divisions.</p></div><span className="version-pill">FOUNDATION BUILD</span></div>
    </div>
  );
}
function Metric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return <div className="metric"><div className="metric-icon">{icon}</div><p>{label}</p><div className="metric-value">{value}</div><span>{hint}</span></div>;
}

function NewWizard({ onBack, onCreate, busy }: { onBack: () => void; onCreate: (input: NewTournamentInput) => Promise<void>; busy: boolean }) {
  const [input, setInput] = useState<NewTournamentInput>({ ...blankInput, startsOn: randomExampleDate() });
  const [teamText, setTeamText] = useState('');
  const [localError, setLocalError] = useState('');
  const teams = useMemo(() => teamText.split(/\r?\n/).map(v => v.trim()).filter(Boolean), [teamText]);
  const update = <K extends keyof NewTournamentInput>(field: K, value: NewTournamentInput[K]) => setInput(old => ({ ...old, [field]: value }));
  const usablePools = Math.min(input.poolCount, Math.max(1, Math.floor(teams.length / 2)));
  const poolSizes = Array.from({ length: usablePools }, (_, i) => Math.floor(teams.length / usablePools) + (i < teams.length % usablePools ? 1 : 0));
  const matchCount = poolSizes.reduce((sum, n) => sum + n * (n - 1) / 2, 0);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLocalError('');
    try {
      if (teams.length < 2 || teams.length > 64) throw new Error('Please enter 2–64 teams.');
      if (new Set(teams.map(x => x.toLocaleLowerCase())).size !== teams.length) throw new Error('Team names must be unique.');
      if (input.poolCount > Math.floor(teams.length / 2)) throw new Error('Each pool needs at least two teams. Reduce the pool count.');
      if (input.targetPoints < 1 || input.targetPoints > 100) throw new Error('Enter a target score between 1 and 100.');
      await onCreate({ ...input, teamNames: teams });
    } catch (e) { setLocalError(e instanceof Error ? e.message : String(e)); }
  };
  return <div className="page-enter"><button className="back-button" onClick={onBack}><ArrowLeft size={16}/> All tournaments</button>
    <div className="page-heading compact"><div><span className="eyebrow">LET'S BUILD SOMETHING GREAT</span><h1>Create a tournament</h1><p>Set your rules. We'll build the pool schedule automatically.</p></div></div>
    <form onSubmit={submit} className="builder-layout"><div className="builder-form">
      <section className="form-card"><div className="form-section-title"><span className="step-num">01</span><div><h2>The essentials</h2><p>Give your tournament a name and a date.</p></div></div>
        <div className="field"><label htmlFor="t-name">Tournament name</label><input id="t-name" value={input.name} required maxLength={120} placeholder="e.g. Fall Classic Volleyball Open" onChange={e => update('name', e.target.value)}/></div>
        <div className="form-grid"><div className="field"><label htmlFor="sport">Sport</label><select id="sport" value={input.sport} onChange={e => update('sport', e.target.value)}><option>Volleyball</option><option>Generic</option></select></div>
          <div className="field"><label htmlFor="date">Tournament date</label><input id="date" type="date" value={input.startsOn} onChange={e => update('startsOn', e.target.value)}/></div></div>
      </section>
      <section className="form-card"><div className="form-section-title"><span className="step-num">02</span><div><h2>Teams & pools</h2><p>Add a team per line and choose how they'll be distributed.</p></div></div>
        <div className="field"><div className="field-inline"><label htmlFor="teams">Team names</label><button type="button" className="text-link" onClick={() => {setTeamText(sampleTeams.join('\n'));update('poolCount',4);}}>Use 16 sample teams <ArrowUpRight size={13}/></button></div>
          <textarea id="teams" rows={7} value={teamText} onChange={e => setTeamText(e.target.value)} placeholder={'Eagles\nWolves\nFalcons\nBears'}/><span className="field-hint">{teams.length} / 64 teams entered. Their order is their initial seed order.</span></div>
        <div className="form-grid"><div className="field"><label htmlFor="poolCount">Number of pools</label><input id="poolCount" type="number" min={1} max={32} value={input.poolCount} onChange={e => update('poolCount',Number(e.target.value))}/></div>
          <div className="field"><label htmlFor="seeding">Pool distribution</label><select id="seeding" value={input.seedMode} onChange={e => update('seedMode',e.target.value as 'snake'|'random')}><option value="snake">Seeded · snake</option><option value="random">Random assignment</option></select></div></div>
      </section>
      <section className="form-card"><div className="form-section-title"><span className="step-num">03</span><div><h2>Game format</h2><p>Configure pool-play scoring and future playoff divisions.</p></div></div>
        <div className="form-grid"><div className="field"><label htmlFor="sets">Sets per pool matchup</label><select id="sets" value={input.poolSets} onChange={e => update('poolSets', Number(e.target.value) as 1|2)}><option value={1}>1 fixed set</option><option value={2}>2 fixed sets (1–1 allowed)</option></select></div>
          <div className="field"><label htmlFor="points">Points to win a set</label><input id="points" type="number" min={1} max={100} value={input.targetPoints} onChange={e => update('targetPoints',Number(e.target.value))}/></div></div>
        <label className="checkbox-row"><input type="checkbox" checked={input.winByTwo} onChange={e => update('winByTwo',e.target.checked)}/><span><strong>Win by two points</strong><small>Sets continue beyond the target until a team leads by two.</small></span></label>
        <div className="subheading">PLANNED PLAYOFF DIVISIONS</div>
        <div className="form-grid"><div className="field"><label htmlFor="gold">Gold bracket</label><select id="gold" value={input.goldFormat} onChange={e => update('goldFormat',e.target.value as 'single'|'double')}><option value="single">Single elimination</option><option value="double">Double elimination</option></select></div>
          <div className="field"><label htmlFor="silver">Silver bracket</label><select id="silver" value={input.silverFormat} onChange={e => update('silverFormat',e.target.value as 'single'|'double')}><option value="single">Single elimination</option><option value="double">Double elimination</option></select></div></div>
        <label className="checkbox-row"><input type="checkbox" checked={input.bracketReset} onChange={e => update('bracketReset',e.target.checked)}/><span><strong>Double-elimination bracket reset</strong><small>The undefeated finalist must lose twice (applies to double-elimination divisions).</small></span></label>
        <div className="info-inline"><ShieldCheck size={17}/> Playoff formats are saved now. Bracket generation will be enabled in a later milestone.</div>
      </section>
      {localError && <div className="form-error" role="alert">{localError}</div>}
      <div className="builder-buttons"><button type="button" className="button button-outline" onClick={onBack}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create tournament'} <ArrowRight size={17}/></button></div>
    </div><aside className="builder-side"><div className="summary-card"><span className="eyebrow">LIVE PREVIEW</span><h3>{input.name.trim() || 'Your tournament'}</h3><p>{input.sport} · {input.startsOn || 'Date TBD'}</p>
        <div className="summary-metrics"><div><strong>{teams.length}</strong><span>Teams</span></div><div><strong>{input.poolCount}</strong><span>Pools</span></div><div><strong>{matchCount}</strong><span>Pool matches</span></div><div><strong>{matchCount*input.poolSets}</strong><span>Pool sets</span></div></div>
        <div className="summary-label">POOLS AT A GLANCE</div>
        {teams.length >= 2 && input.poolCount <= teams.length / 2 ? <div className="preview-pools">{poolSizes.map((n, i) => <div key={i}><span>Pool {String.fromCharCode(65+i)}</span><strong>{n} teams</strong></div>)}</div> : <div className="preview-placeholder">Add enough teams to preview pool distribution.</div>}
        <div className="summary-divider"/><div className="preview-formats"><span><Medal size={16}/> Gold</span><strong>{titleCase(input.goldFormat)} elim</strong></div><div className="preview-formats"><span><Medal size={16}/> Silver</span><strong>{titleCase(input.silverFormat)} elim</strong></div>
      </div><p className="sidebar-tip"><Sparkles size={17}/> You can create a draft first, review everything, and publish when ready.</p></aside></form>
  </div>;
}

function TournamentPage({ bundle, isOwner, busy, onBack, onStatus, onScore, onDelete }: {
  bundle: TournamentBundle; isOwner: boolean; busy: boolean; onBack: () => void;
  onStatus: (next: 'published'|'pool_play') => Promise<void>; onScore: (match: Match, scores: Array<[number,number]>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [activePool, setActivePool] = useState(bundle.pools[0]?.id ?? '');
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [copied, setCopied] = useState(false);
  const t = bundle.tournament;
  const complete = bundle.matches.filter(m => m.status === 'completed').length;
  const scheduled = bundle.matches.length;
  const teamName = (id: string) => bundle.teams.find(x => x.id === id)?.name ?? 'Unknown team';
  const shareUrl = `${window.location.origin}${window.location.pathname}?t=${encodeURIComponent(t.id)}`;
  const publicReady = t.status !== 'draft';
  const firstPool = bundle.pools.some(p => p.id === activePool) ? activePool : bundle.pools[0]?.id;
  const qualifications = useMemo(() => {
    const gold: Array<{team: string;pool: string}> = [], silver: Array<{team:string;pool:string}> = [];
    for (const p of bundle.pools) {
      const ranking = standingsForPool(bundle, p.id);
      ranking.forEach((r,i) => (i < Math.ceil(ranking.length / 2) ? gold : silver).push({team:r.team.name,pool:p.label}));
    }
    return { gold, silver };
  }, [bundle]);
  return <div className="page-enter"><button className="back-button" onClick={onBack}><ArrowLeft size={16}/> All tournaments</button>
    <div className="detail-heading"><div><div className="title-overline"><span className={`status-tag ${t.status === 'draft' ? 'muted' : 'live'}`}>{statusLabel(t.status)}</span><span className="overline-separator">•</span><span>{t.sport}</span></div>
      <h1>{t.name}</h1><p><CalendarDays size={16}/>{t.starts_on ?? 'Date not set'} <span className="dot-sep">·</span> {bundle.teams.length} teams <span className="dot-sep">·</span> {bundle.pools.length} pools</p></div>
      <div className="detail-actions">{publicReady && <button className="button button-outline" onClick={async () => {await navigator.clipboard.writeText(shareUrl);setCopied(true);window.setTimeout(()=>setCopied(false),2000);}}>{copied ? <Check size={16}/> : <Copy size={16}/>} {copied ? 'Copied' : 'Copy public link'}</button>}
        {isOwner && t.status === 'draft' && <button className="button button-primary" disabled={busy} onClick={() => onStatus('published')}><ExternalLink size={16}/> Publish tournament</button>}
        {isOwner && t.status === 'published' && <button className="button button-primary" disabled={busy} onClick={() => onStatus('pool_play')}><Flag size={16}/> Start pool play</button>}
      </div></div>
    {demoMode && <div className="demo-banner"><LockKeyhole size={17}/><span>Demo mode: your tournament is saved in this browser only. Public links and multi-device access require a connected Supabase project.</span></div>}
    <div className="detail-metrics"><Metric icon={<UsersRound size={20}/>} label="Teams" value={String(bundle.teams.length)} hint="Registered"/><Metric icon={<ListChecks size={20}/>} label="Pool matchups" value={String(scheduled)} hint={`${scheduled*t.pool_sets} scheduled sets`}/><Metric icon={<CheckCircle2 size={20}/>} label="Results entered" value={`${complete}/${scheduled}`} hint={`${scheduled ? Math.round(100*complete/scheduled) : 0}% completed`}/></div>
    <div className="tabs" role="tablist" aria-label="Tournament sections">{([['overview','Overview'],['pools','Pool play & scores'],['playoffs','Playoffs']] as const).map(([key,label]) => <button key={key} role="tab" aria-selected={tab===key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>)}</div>
    {tab === 'overview' && <div className="overview-layout"><div className="white-card"><div className="card-heading"><h2>Competition structure</h2><span className="subtle-tag">Ready to run</span></div><p className="section-desc">Your round-robin schedule has been generated automatically.</p>
      <div className="structure-rows"><div><span className="structure-icon"><UsersRound size={19}/></span><div><strong>Pool play</strong><small>{bundle.pools.length} pools · {t.pool_sets} fixed set{t.pool_sets>1?'s':''} per matchup · first to {t.target_points}{t.win_by_two ? ', win by 2' : ''}</small></div><CheckCircle2 size={19} className="ok"/></div>
        <div><span className="structure-icon"><Medal size={19}/></span><div><strong>Gold division</strong><small>{titleCase(bundle.divisions.find(d=>d.name==='Gold')?.format??'double')} elimination · future bracket</small></div><span className="soon">PLANNED</span></div>
        <div><span className="structure-icon"><Medal size={19}/></span><div><strong>Silver division</strong><small>{titleCase(bundle.divisions.find(d=>d.name==='Silver')?.format??'single')} elimination · future bracket</small></div><span className="soon">PLANNED</span></div></div>
      <button className="button button-outline" onClick={() => setTab('pools')}>View pools and schedule <ArrowRight size={16}/></button></div>
      <div className="white-card"><div className="card-heading"><h2>Your pools</h2><span className="subtle-tag">{bundle.pools.length} total</span></div>
        <div className="pool-summary-list">{bundle.pools.map(p => <button key={p.id} onClick={() => {setActivePool(p.id);setTab('pools');}}><span className="pool-letter">{p.label.slice(-1)}</span><div><strong>{p.label}</strong><small>{bundle.poolTeams.filter(x=>x.pool_id===p.id).length} teams · {bundle.matches.filter(x=>x.pool_id===p.id).length} matches</small></div><ChevronRight size={17}/></button>)}</div>
        {isOwner && <button className="danger-text" onClick={onDelete}>Permanently delete tournament</button>}</div></div>}
    {tab === 'pools' && <div className="pool-play-area"><div className="pool-switcher">{bundle.pools.map(pool => <button key={pool.id} className={firstPool===pool.id?'active':''} onClick={()=>setActivePool(pool.id)}>{pool.label}</button>)}</div>
      {bundle.pools.filter(p=>p.id===firstPool).map(pool => <PoolPanel key={pool.id} pool={pool} bundle={bundle} isOwner={isOwner} teamName={teamName} onEdit={setEditingMatch}/>)}</div>}
    {tab === 'playoffs' && <div className="white-card playoff-preview"><div className="playoff-icon"><Swords size={26}/></div><span className="eyebrow">UPCOMING MILESTONE</span><h2>Playoff brackets</h2><p>Gold and Silver configurations are saved. The elimination bracket engine, qualification approval, and automatic advancement will be added in the next development milestone.</p>
      <div className="division-preview">{bundle.divisions.map(d=><div key={d.id}><div className="division-preview-heading"><Medal size={18}/><strong>{d.name} division</strong><span className="format-pill">{d.format === 'double'?'Double elimination':'Single elimination'}</span></div>
        <div className="candidate-list">{(d.name==='Gold'?qualifications.gold:qualifications.silver).map((c,i)=><div key={i}><span>{c.team}</span><small>{c.pool}</small></div>)}</div></div>)}</div>
      <div className="info-inline center"><ShieldCheck size={17}/> Provisional placements only. No official playoff seeds or brackets have been generated.</div>
    </div>}
    {editingMatch && <ScoreModal key={editingMatch.id} match={editingMatch} bundle={bundle} busy={busy} onClose={()=>setEditingMatch(null)} teamName={teamName}
      onSave={async pairs=>{await onScore(editingMatch,pairs);setEditingMatch(null);}}/>}
  </div>;
}

function PoolPanel({ pool, bundle, isOwner, teamName, onEdit }: {
  pool: Pool; bundle: TournamentBundle; isOwner: boolean; teamName: (id:string)=>string; onEdit: (match:Match)=>void;
}) {
  const standings = standingsForPool(bundle,pool.id);
  const matches = bundle.matches.filter(m => m.pool_id === pool.id);
  const permitted = isOwner && ['published','pool_play'].includes(bundle.tournament.status);
  return <div className="pool-columns"><div className="white-card"><div className="card-heading"><h2>{pool.label} standings</h2><span className="subtle-tag">Live results</span></div><div className="table-scroll"><table className="standings-table"><thead><tr><th>#</th><th>TEAM</th><th>SW</th><th>SL</th><th>WIN %</th><th>PF</th><th>PA</th></tr></thead><tbody>{standings.map(s=><tr key={s.team.id}><td><span className={`rank-number ${s.rank<=2?'top-rank':''}`}>{s.rank}</span></td><td className="team-cell">{s.team.name}</td><td>{s.wins}</td><td>{s.losses}</td><td className="pct-cell">{(s.winPct*100).toFixed(1)}%</td><td>{s.pointsFor}</td><td>{s.pointsAgainst}</td></tr>)}</tbody></table></div>
    <p className="table-caption">SW = sets won · SL = sets lost · PF/PA = points for/against. Ties: head-to-head for exactly two teams, then point ratio and normalized differential.</p></div>
    <div className="white-card"><div className="card-heading"><div><h2>Match schedule</h2><p className="section-desc">{matches.filter(m=>m.status==='completed').length} of {matches.length} complete</p></div><span className="subtle-tag">{bundle.tournament.pool_sets} set{bundle.tournament.pool_sets>1?'s':''} each</span></div>
      <div className="match-list">{matches.map(m=>{const scores = bundle.scores.filter(s=>s.match_id===m.id).sort((a,b)=>a.set_number-b.set_number);return <div className="match-row" key={m.id}><div className="match-left"><span className="match-seq">R{m.round_number}</span><div className="match-teams"><strong>{teamName(m.team_a_id)} <span>vs</span> {teamName(m.team_b_id)}</strong><small>{m.status==='completed'?'Final score':'Not played'}</small></div></div>
      <div className="match-right">{scores.length?<div className="small-scores">{scores.map(s=><span key={s.set_number}>{s.score_a}–{s.score_b}</span>)}</div>:<span className="awaiting">—</span>}
        {permitted && <button className="score-action" onClick={()=>onEdit(m)}>{m.status==='completed'?'Edit':'Enter score'}<ChevronRight size={15}/></button>}
      </div></div>})}</div>
      {!permitted && isOwner && <p className="table-caption">Publish the tournament and start pool play to enable score entry.</p>}
    </div></div>;
}
function ScoreModal({ match, bundle, teamName, busy, onClose, onSave }: {
  match: Match; bundle: TournamentBundle; teamName:(id:string)=>string;
  busy:boolean; onClose:()=>void; onSave:(pairs:Array<[number,number]>)=>Promise<void>;
}) {
  const existing = bundle.scores.filter(s=>s.match_id===match.id).sort((a,b)=>a.set_number-b.set_number);
  const [pairs,setPairs] = useState<Array<[string,string]>>(Array.from({length:bundle.tournament.pool_sets},(_,i): [string,string]=>[String(existing[i]?.score_a??''),String(existing[i]?.score_b??'')]));
  const [error,setError]=useState('');
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    const parsed = pairs.map(([a,b])=>[a===''?NaN:Number(a),b===''?NaN:Number(b)] as [number,number]);
    const validation = scoreError(parsed,bundle.tournament.pool_sets,bundle.tournament.target_points,bundle.tournament.win_by_two);
    if(validation){setError(validation);return;}
    try {await onSave(parsed);}catch(e){setError(e instanceof Error?e.message:String(e));}
  };
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="score-dialog-title"><button className="modal-x" onClick={onClose} aria-label="Close"><X size={19}/></button>
    <div className="modal-kicker"><ClipboardList size={18}/> POOL PLAY · ROUND {match.round_number}</div><h2 id="score-dialog-title">Enter match score</h2><p className="modal-desc">Each set counts independently toward the standings. If there are two sets, a 1–1 split is allowed.</p>
    <form onSubmit={save}><div className="score-header"><strong>{teamName(match.team_a_id)}</strong><span>VS</span><strong>{teamName(match.team_b_id)}</strong></div>
      {pairs.map((row,i)=><div className="score-entry-row" key={i}><span>Set {i+1}</span><input aria-label={`Set ${i+1} ${teamName(match.team_a_id)} score`} required type="number" min={0} max={999} value={row[0]} onChange={e=>setPairs(old=>old.map((v,j)=>j===i?([e.target.value,v[1]] as [string,string]):v))}/><span>—</span><input aria-label={`Set ${i+1} ${teamName(match.team_b_id)} score`} required type="number" min={0} max={999} value={row[1]} onChange={e=>setPairs(old=>old.map((v,j)=>j===i?([v[0],e.target.value] as [string,string]):v))}/></div>)}
      <div className="score-help">First to {bundle.tournament.target_points}{bundle.tournament.win_by_two?', win by 2':''}. Scores update all pool standings automatically.</div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-footer"><button className="button button-outline" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}><Save size={16}/> {busy?'Saving…':'Save result'}</button></div>
    </form></div></div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
