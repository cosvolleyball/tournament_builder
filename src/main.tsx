import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check,
  CheckCircle2, ChevronRight, ClipboardList, Copy, ExternalLink, Flag,
  GitBranch, LayoutDashboard, ListChecks, LockKeyhole, Medal, Menu, Plus,
  Save, ShieldCheck, Sparkles, Trophy,
  UsersRound, Volleyball, X,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import type { BracketAssignments, Match, NewTournamentInput, PlannedBracket, PlayoffMatch, PlayoffRoundRule, RoundRulesByBracket, Pool, SetScore, Tournament, TournamentBundle } from './types';
import { assignPools, createBundle, scoreError, scoringForPool, standingsForPool, validateScoringRules } from './engine';
import { previewSingleElimination, suggestedAssignments, validateAssignments, playoffRoundCount, rankedPoolTeams, qualifiedTeamIds, distributeQualifiers, suggestedByeFreeWildcards, byeFreeAssignmentsError, type QualificationRule } from './playoffs';
import { effectiveRoundRule, evaluateSeries, roundRuleError, scorePairs } from './playoffFormats';
import { addCompetitionDivision, changeStatus, correctPlayoffScore, createTournament, deleteTournament, demoMode, finalizePoolAndCreatePlayoffs, getTournament, listPublishedTournaments, listTournaments, submitPlayoffScore, submitScore, supabase, type PublishedTournament } from './repository';
import './style.css';

type Screen = 'home' | 'new' | 'detail' | 'addDivision';
type DetailTab = 'overview' | 'pools' | 'playoffs';
const sampleTeams = Array.from({ length: 16 }, (_, i) => `Team ${i + 1}`);
const today = new Date().toISOString().slice(0, 10);
const blankInput: NewTournamentInput = {
  name: '', divisionName: 'Open', sport: 'Volleyball', startsOn: today, teamNames: [], poolCount: 4,
  poolSets: 2, targetPoints: 21, winByTwo: true, pointCap: null, poolScoring: [], seedMode: 'snake',
  playoffBrackets: [{ name: 'Championship', format: 'single', bracketReset: true }],
};
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const statusLabel = (status: string) => status === 'pool_play' ? 'Pool play active' : titleCase(status);
const randomExampleDate = () => new Date(Date.now() + 86400 * 1000 * 7).toISOString().slice(0, 10);

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(demoMode);
  const [screen, setScreen] = useState<Screen>(new URLSearchParams(window.location.search).has('t') ? 'detail' : 'home');
  const [activeId, setActiveId] = useState(new URLSearchParams(window.location.search).get('t'));
  const [activeDivisionId, setActiveDivisionId] = useState(new URLSearchParams(window.location.search).get('d'));
  const [records, setRecords] = useState<Tournament[]>([]);
  const [bundle, setBundle] = useState<TournamentBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  // After an explicit logout, prevent history navigation from redisplaying the
  // previous organizer workspace. A fresh direct public tournament link is still
  // readable when the tournament has been published.
  const signedOutHere = useRef(false);
  const previousUserId = useRef<string | null>(null);
  // Discard results from requests started under a previous authenticated user.
  const workspaceVersion = useRef(0);
  const owner = demoMode || !!(session?.user.id && bundle && session.user.id === bundle.tournament.owner_id);

  /**
   * Remove organizer-only data on logout. This is a client-side privacy measure;
   * real access control is still enforced by Supabase Row Level Security.
   * replaceState drops the current detail URL without creating another history
   * entry. The Back handler below guards older entries in this browser tab.
   */
  const clearPrivateWorkspace = () => {
    workspaceVersion.current += 1;
    setRecords([]);
    setBundle(null);
    setScreen('home');
    setActiveId(null);
    setActiveDivisionId(null);
    setLoginOpen(false);
    setMobileMenu(false);
    setError('');
    setToast('');
    setLoading(false);
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  };

  useEffect(() => {
    if (!supabase) return;

    // Supabase emits INITIAL_SESSION after checking stored login credentials.
    // Avoid a second competing getSession request that could restore old state.
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT') {
        signedOutHere.current = true;
        previousUserId.current = null;
        setSession(null);
        clearPrivateWorkspace();
      } else {
        const nextUserId = nextSession?.user.id ?? null;
        if (previousUserId.current && nextUserId && previousUserId.current !== nextUserId) {
          // Prevent data from the prior organizer appearing when switching users.
          clearPrivateWorkspace();
        }
        if (nextUserId) signedOutHere.current = false;
        previousUserId.current = nextUserId;
        setSession(nextSession);
      }
      setAuthChecked(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!authChecked) return;
    if (!demoMode && !userId) {
      setRecords([]);
      return;
    }
    let cancelled = false;
    listTournaments(userId)
      .then(next => { if (!cancelled) setRecords(next); })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [userId, authChecked]);

  useEffect(() => {
    // Clear old details immediately when a new detail load begins. Ignore
    // responses from a previous login, tournament, or unmounted effect.
    if (!activeId || screen !== 'detail' || !authChecked) return;
    let cancelled = false;
    setBundle(null);
    setLoading(true);
    setError('');
    getTournament(activeId,activeDivisionId)
      .then(next => { if (!cancelled) setBundle(next); })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeId, activeDivisionId, screen, authChecked, userId]);

  useEffect(() => {
    const handler = () => {
      if (signedOutHere.current && !demoMode) {
        // Browsers keep history entries; we can prevent them rendering private
        // content, but cannot erase the browser's entire Back history.
        clearPrivateWorkspace();
        return;
      }
      const id = new URLSearchParams(window.location.search).get('t');
      setActiveId(id);
      setActiveDivisionId(new URLSearchParams(window.location.search).get('d'));
      setScreen(id ? 'detail' : 'home');
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  // Keep open tournament pages up to date for spectators without requiring
  // Supabase Realtime replication settings. Scores are refreshed periodically
  // when the tab is visible; a new score is reloaded immediately after saving.
  useEffect(() => {
    if (!supabase || !authChecked || screen !== 'detail' || !activeId) return;
    const id = activeId;
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      const version = workspaceVersion.current;
      try {
        const next = await getTournament(id,activeDivisionId);
        if (cancelled || workspaceVersion.current !== version) return;
        setBundle(current => current?.tournament.id === id ? next : current);
      } catch {
        // A temporary network failure should not interrupt an active score form.
        // Explicit actions still surface errors through their normal UI paths.
      }
    };
    const timer = window.setInterval(refresh, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [authChecked, screen, activeId, activeDivisionId, userId]);

  const navigate = (where: Screen, id: string | null = null, divisionId: string | null = null) => {
    if (where === 'new' && !demoMode && !session) { setToast('Sign in to create a tournament.'); return; }
    const url = id ? `?t=${encodeURIComponent(id)}${divisionId?`&d=${encodeURIComponent(divisionId)}`:''}` : window.location.pathname;
    window.history.pushState(null, '', url);
    setScreen(where); setActiveId(id); setActiveDivisionId(divisionId); setMobileMenu(false); setError('');
  };
  const reload = async (id: string) => {
    const version = workspaceVersion.current;
    const [next, summaries] = await Promise.all([getTournament(id,activeDivisionId), listTournaments(session?.user.id ?? null)]);
    if (workspaceVersion.current !== version) return;
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
    const version = workspaceVersion.current;
    await perform(async () => {
      await createTournament(created, session?.user.id ?? null);
      const next = await listTournaments(session?.user.id ?? null);
      if (workspaceVersion.current !== version) return;
      setRecords(next);
      navigate('detail', created.tournament.id);
    }, 'Tournament created successfully.');
  };
  const handleAddDivision = async (input: NewTournamentInput) => {
    if (!bundle || !owner) throw new Error('An organizer must select a draft tournament.');
    const parentId = bundle.tournament.id;
    const created = createBundle({...input,name:bundle.tournament.name,
      sport:bundle.tournament.sport,startsOn:bundle.tournament.starts_on??''});
    await perform(async () => {
      const newDivisionId = await addCompetitionDivision(parentId,created,session?.user.id??null);
      navigate('detail',parentId,newDivisionId);
    }, `Division “${created.competitionDivisionName}” added.`);
  };
  const handleStatus = async (status: 'published' | 'pool_play') => {
    if (!bundle) return;
    await perform(async () => { await changeStatus(bundle.tournament.id, status); await reload(bundle.tournament.id); },
      status === 'published' ? 'Tournament published.' : 'Pool play started.');
  };
  const handleScore = async (match: Match, pairs: Array<[number, number]>) => {
    if (!bundle) return;
    const rules = scoringForPool(bundle, match.pool_id);
    const reason = scoreError(pairs, bundle.tournament.pool_sets, rules.targetPoints, rules.winByTwo, rules.pointCap);
    if (reason) throw new Error(reason);
    const scores: SetScore[] = pairs.map(([score_a, score_b], i) => ({ match_id: match.id, set_number: i + 1, score_a, score_b }));
    setLoading(true);
    try {
      await submitScore(bundle.tournament.id, match.id, scores, !owner);
      await reload(bundle.tournament.id);
      setToast(owner ? 'Score saved and standings updated.' : 'Score submitted. Only an organizer can correct it.');
    } finally { setLoading(false); }
  };
  // The alpha build uses the pre-created Supabase email/password account.
  // Public signups are disabled at the Supabase project level.
  /** Organizer review is authoritative only after Supabase validates every pool result and seed. */
  const handleFinalizePlayoffs = async (assignments: BracketAssignments, roundRules: RoundRulesByBracket, noByes: boolean) => {
    if (!bundle || !owner) throw new Error('Only an organizer may finalize pool play.');
    const id = bundle.tournament.id;
    await perform(async () => {
      await finalizePoolAndCreatePlayoffs(bundle, assignments, roundRules, noByes);
      await reload(id);
    }, bundle.divisions.length ? 'Pool play finalized. Playoff brackets generated.' : 'Final standings approved.');
  };
  /**
   * New playoff scores are open to players without sign-in; corrections of
   * completed matches use a separate, owner-only RPC. Both refresh the bracket.
   */
  const handlePlayoffScore = async (match: PlayoffMatch, scores: SetScore[]) => {
    if (!bundle) return;
    const id = bundle.tournament.id;
    setLoading(true);
    try {
      if (match.status === 'completed') {
        if (!owner) throw new Error('Only an organizer can correct completed playoff scores.');
        await correctPlayoffScore(match.id, scores);
      } else {
        await submitPlayoffScore(match.id, scores);
      }
      await reload(id);
      setToast(match.status === 'completed'
        ? 'Playoff result corrected. Advancing team updated if needed.'
        : 'Playoff result recorded. Winner advanced automatically.');
    } finally { setLoading(false); }
  };
  const signIn = () => setLoginOpen(true);
  const submitLogin = async (email: string, password: string) => {
    if (!supabase) return;
    const { error: authError } = await supabase.auth.signInWithPassword({email, password});
    if (authError) throw new Error(authError.message);
    setLoginOpen(false);
    setToast('Signed in successfully.');
  };
  const handleSignOut = async () => {
    if (!supabase) return;
    try {
      const { error: authError } = await supabase.auth.signOut();
      if (authError) throw authError;
      // The SIGNED_OUT event above clears all local tournament state.
      // Also enforce the reset explicitly in case the event was delayed.
      signedOutHere.current = true;
      setSession(null);
      clearPrivateWorkspace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const handleDelete = async () => {
    if (!bundle || !window.confirm(`Permanently delete “${bundle.tournament.name}”? This cannot be undone.`)) return;
    const id = bundle.tournament.id;
    const version = workspaceVersion.current;
    await perform(async () => {
      await deleteTournament(id);
      const next = await listTournaments(session?.user.id ?? null);
      if (workspaceVersion.current !== version) return;
      setRecords(next);
      setBundle(null);
      navigate('home');
    }, 'Tournament deleted.');
  };
  // Never pass stale organizer data to visible components after signout.
  const authenticatedWorkspace = demoMode || !!session;
  const visibleRecords = authenticatedWorkspace ? records : [];
  const showHome = screen === 'home';
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
        <div className="brand" onClick={() => navigate('home')} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') navigate('home'); }}>
          <span className="brand-icon"><Trophy size={23} strokeWidth={2.2}/></span>
          <span className="brand-words"><strong>Tournament<span>Builder</span></strong><small>BETA</small></span>
        </div>
        <div className="sidebar-content">
          <div className="sidebar-label">WORKSPACE</div>
          <button className={`side-link ${showHome ? 'selected' : ''}`} onClick={() => navigate('home')}><LayoutDashboard size={18}/> {authenticatedWorkspace ? 'Dashboard' : 'Home'}</button>
          {authenticatedWorkspace && <>
          <button className={`side-link ${screen === 'new' ? 'selected' : ''}`} onClick={() => navigate('new')}><Plus size={19}/> New tournament</button>
          <div className="sidebar-label space-above">YOUR TOURNAMENTS</div>
          {visibleRecords.length ? visibleRecords.slice(0, 7).map(t => (
            <button key={t.id} className={`side-link tournament-link ${activeId === t.id ? 'selected' : ''}`} onClick={() => navigate('detail', t.id)}>
              <span className="mini-dot"/> <span className="truncate">{t.name}</span>
            </button>
          )) : <div className="sidebar-empty">Your tournaments will appear here.</div>}
          </>}
        </div>
        <div className="sidebar-footer">
          <div className="footer-badge"><ShieldCheck size={16}/><span>{demoMode ? 'LOCAL DEMO MODE' : 'SUPABASE CONNECTED'}</span></div>
          <p>{demoMode ? 'Data is saved only in this browser.' : 'Protected by database access policies.'}</p>
          <div className="footer-bottom"><span>BUILD 0.6 · ALPHA</span><GitBranch size={17}/></div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileMenu(v => !v)} aria-label="Open menu"><Menu size={21}/></button>
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={15}/><strong>{!authenticatedWorkspace && screen === 'home' ? 'Home' : screen === 'new' ? 'New tournament' : screen === 'addDivision' ? 'New division' : screen === 'detail' ? (bundle?.tournament.name ?? 'Tournament') : 'Overview'}</strong></div>
          <div className="topbar-actions">
            {demoMode ? <span className="mode-pill"><span className="online-dot"/> Demo workspace</span> : !session ? <button className="button button-outline small" onClick={signIn}>Organizer sign in</button>
              : <button className="account-button" onClick={handleSignOut} title="Sign out"><span className="avatar">{(session.user.email?.[0] ?? 'U').toUpperCase()}</span><span className="account-email">{session.user.email}</span><span className="signout-label">Sign out</span></button>}
          </div>
        </header>
        <div className="content">
          {error && <div className="error-alert" role="alert"><strong>Something needs attention</strong><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
          {!authChecked ? <div className="center-message">Checking your session…</div>
            : screen === 'home' ? (authenticatedWorkspace
                ? <Dashboard records={visibleRecords} onNew={() => navigate('new')} onOpen={id => navigate('detail', id)} isSignedIn signIn={signIn}/>
                : <PublicHome onSignIn={signIn}/>)
            : screen === 'new' && !authenticatedWorkspace ? <PublicHome onSignIn={signIn}/>
            : screen === 'new' ? <NewWizard onBack={() => navigate('home')} onCreate={handleCreate} busy={loading}/>
            : screen === 'addDivision' && bundle && owner && bundle.tournament.status==='draft'
                ? <NewWizard key={bundle.tournament.id} existingTournament={bundle.tournament}
                    onBack={()=>navigate('detail',bundle.tournament.id,bundle.selectedCompetitionDivisionId)}
                    onCreate={handleAddDivision} busy={loading}/>
                : screen === 'addDivision' ? <div className="center-message">New divisions can only be added before publishing.</div>
            : loading && !bundle ? <div className="center-message">Loading tournament…</div>
            : bundle && activeId === bundle.tournament.id ? <TournamentPage key={`${bundle.tournament.id}:${bundle.selectedCompetitionDivisionId??''}`}
                bundle={bundle} isOwner={owner} busy={loading} onBack={() => navigate('home')}
                onSelectDivision={divisionId=>navigate('detail',bundle.tournament.id,divisionId)}
                onAddDivision={()=>navigate('addDivision',bundle.tournament.id,bundle.selectedCompetitionDivisionId)} onStatus={handleStatus} onScore={handleScore} onDelete={handleDelete} onFinalize={handleFinalizePlayoffs} onPlayoffScore={handlePlayoffScore}/>
            : <div className="center-message">Tournament not found or not accessible. <button className="text-link" onClick={() => navigate('home')}>Back to dashboard</button></div>}
        </div>
      </main>
      {loginOpen && <AlphaLogin onClose={() => setLoginOpen(false)} onSubmit={submitLogin}/>}
      {toast && <div className="toast" role="status"><CheckCircle2 size={18}/>{toast}</div>}
    </div>
  );
}

/**
 * Anonymous homepage: published tournament discovery plus organizer sign-in.
 * The public query does not retrieve an organizer's drafts or workspace data.
 */
function PublicHome({ onSignIn }: { onSignIn: () => void }) {
  const [published, setPublished] = useState<PublishedTournament[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(true);
  const [directoryError, setDirectoryError] = useState('');
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingDirectory(true);
    setDirectoryError('');
    listPublishedTournaments()
      .then(rows => { if (!cancelled) setPublished(rows); })
      .catch(cause => {
        if (!cancelled) setDirectoryError(
          cause instanceof Error ? cause.message : String(cause)
        );
      })
      .finally(() => { if (!cancelled) setLoadingDirectory(false); });
    return () => { cancelled = true; };
  }, [refreshCounter]);

  return <div className="page-enter public-home">
    <span className="eyebrow">TOURNAMENT MANAGEMENT, SIMPLIFIED</span>
    <div className="page-heading">
      <div><h1>Find your tournament.<br/><span>Follow every match.</span></h1>
        <p>Browse published tournaments, view standings and follow playoff brackets without signing in.</p></div>
    </div>
    <section aria-labelledby="published-tournaments-heading">
      <div className="section-heading public-directory-heading">
        <div><h2 id="published-tournaments-heading">Published tournaments</h2>
          <p>Choose a tournament to view its public schedule, results and playoff brackets.</p></div>
        <button type="button" className="button button-outline small" onClick={() => setRefreshCounter(n => n + 1)}
          disabled={loadingDirectory}>Refresh</button>
      </div>
      {loadingDirectory ? <div className="public-directory-message" role="status">Loading published tournaments…</div>
      : directoryError ? <div className="public-directory-message" role="alert">
        We couldn't load the tournament list. {directoryError}
        <button type="button" className="text-link" onClick={() => setRefreshCounter(n => n + 1)}>Try again</button>
      </div>
      : published.length ? <div className="tournament-grid">
        {published.map(tournament => <a key={tournament.id} className="t-card public-t-card"
          href={`${window.location.pathname}?t=${encodeURIComponent(tournament.id)}`}
          aria-label={`Open ${tournament.name} tournament`}>
          <div className="t-card-top"><div className="t-icon"><Trophy size={24}/></div>
            <span className="status-tag live">{statusLabel(tournament.status)}</span></div>
          <h3>{tournament.name}</h3>
          <div className="t-card-meta"><span><CalendarDays size={15}/>{tournament.starts_on ?? 'Date to be announced'}</span></div>
          <div className="t-card-bottom"><span>{tournament.sport}</span>
            <span className="public-card-open">View tournament <ArrowUpRight size={17}/></span></div>
        </a>)}
      </div>
      : <div className="public-directory-message">There are no published tournaments yet. Check back when an organizer publishes one.</div>}
    </section>
    <div className="public-welcome white-card">
      <LockKeyhole size={24}/>
      <h2>Organizing a tournament?</h2>
      <p>Sign in to create tournaments, enter scores and manage your events.</p>
      <button className="button button-primary" onClick={onSignIn}>Organizer sign in <ArrowRight size={17}/></button>
    </div>
  </div>;
}

function Dashboard({ records, onNew, onOpen, isSignedIn, signIn }: {
  records: Tournament[]; onNew: () => void; onOpen: (id: string) => void; isSignedIn: boolean; signIn: () => void;
}) {
  return (
    <div className="page-enter">
      <div className="welcome-line"><span className="eyebrow">TOURNAMENT MANAGEMENT, SIMPLIFIED</span></div>
      <div className="page-heading"><div><h1>Run the game.<br/><span>We'll handle the rest.</span></h1><p>From the first pool match to the final point. All your tournaments, all in one place.</p></div>
        <button className="button button-primary heading-cta" onClick={isSignedIn ? onNew : signIn}>{isSignedIn ? <><Plus size={17}/> Create tournament</> : 'Organizer sign in'}<ArrowRight size={17}/></button>
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
      <div className="feature-note"><div className="note-icon"><Sparkles size={22}/></div><div><strong>Built for volleyball. Ready for more.</strong><p>Flexible pool formats, automatic standings, and optional Championship or multi-bracket playoffs.</p></div><span className="version-pill">FOUNDATION BUILD</span></div>
    </div>
  );
}
function Metric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return <div className="metric"><div className="metric-icon">{icon}</div><p>{label}</p><div className="metric-value">{value}</div><span>{hint}</span></div>;
}

function NewWizard({ onBack, onCreate, busy, existingTournament }: {
  onBack: () => void; onCreate: (input: NewTournamentInput) => Promise<void>;
  busy: boolean; existingTournament?: Tournament;
}) {
  const [input, setInput] = useState<NewTournamentInput>({ ...blankInput,
    name:existingTournament?.name??'', sport:existingTournament?.sport??'Volleyball',
    startsOn:existingTournament?.starts_on??randomExampleDate(),
    divisionName:existingTournament?'':'Open',
  });
  const [teamText, setTeamText] = useState('');
  const [playoffMode, setPlayoffMode] = useState<'championship' | 'multi' | 'none'>('championship');
  const [localError, setLocalError] = useState('');
  const teams = useMemo(() => teamText.split(/\r?\n/).map(v => v.trim()).filter(Boolean), [teamText]);
  // Pool-specific settings are kept by index until the user creates the pools.
  // Each pool's 'enabled' switch controls inheritance of division defaults.
  const updatePoolRule = (index: number, patch: Partial<NonNullable<NewTournamentInput['poolScoring']>[number]>) => {
    setInput(old => {
      const updated = [...(old.poolScoring ?? [])];
      const current = updated[index] ?? {
        enabled: false, targetPoints: old.targetPoints,
        winByTwo: old.winByTwo, pointCap: old.pointCap ?? null,
      };
      updated[index] = {...current, ...patch};
      return {...old, poolScoring: updated};
    });
  };
  const update = <K extends keyof NewTournamentInput>(field: K, value: NewTournamentInput[K]) => setInput(old => ({ ...old, [field]: value }));
  const selectPlayoffMode = (mode: 'championship' | 'multi' | 'none') => {
    setPlayoffMode(mode);
    // Presets are intentional starting points; the organizer can rename or
    // change the elimination format of every planned bracket below.
    const next: PlannedBracket[] = mode === 'championship'
      ? [{ name: 'Championship', format: 'single', bracketReset: true }]
      : mode === 'multi' ? [
        { name: 'Gold', format: 'double', bracketReset: true },
        { name: 'Silver', format: 'single', bracketReset: false },
      ] : [];
    update('playoffBrackets', next);
  };
  const editBracket = (index: number, patch: Partial<PlannedBracket>) => {
    update('playoffBrackets', input.playoffBrackets.map((b, i) => i === index ? {...b, ...patch} : b));
  };
  const addBracket = () => {
    if (input.playoffBrackets.length >= 8) return;
    const nextName = input.playoffBrackets.length === 2 ? 'Bronze' : `Bracket ${input.playoffBrackets.length + 1}`;
    update('playoffBrackets', [...input.playoffBrackets, {name:nextName,format:'single',bracketReset:false}]);
  };
  const usablePools = Math.min(input.poolCount, Math.max(1, Math.floor(teams.length / 2)));
  // Match the actual snake distribution; the extra team may land in the
  // final pool rather than always Pool A. Random mode balances counts equally.
  const previewAssignments = assignPools(
    Array.from({length:teams.length},(_,i)=>String(i)),
    Array.from({length:usablePools},(_,i)=>String(i)),
    input.seedMode, () => 0.5,
  );
  const poolSizes = Array.from({length:usablePools},(_,i)=>
    previewAssignments.filter(row=>row.pool_id===String(i)).length,
  );
  const matchCount = poolSizes.reduce((sum, n) => sum + n * (n - 1) / 2, 0);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLocalError('');
    try {
      if (teams.length < 2 || teams.length > 64) throw new Error('Please enter 2–64 teams.');
      if (new Set(teams.map(x => x.toLocaleLowerCase())).size !== teams.length) throw new Error('Team names must be unique.');
      if (input.poolCount > Math.floor(teams.length / 2)) throw new Error('Each pool needs at least two teams. Reduce the pool count.');
      validateScoringRules({targetPoints:input.targetPoints, winByTwo:input.winByTwo, pointCap:input.pointCap ?? null});
      for (let i=0;i<input.poolCount;i++) {
        const rule = input.poolScoring?.[i];
        if (rule?.enabled) validateScoringRules(rule);
      }
      if (!(input.divisionName??'').trim()) throw new Error('Name this competition division.');
      await onCreate({ ...input, teamNames: teams });
    } catch (e) { setLocalError(e instanceof Error ? e.message : String(e)); }
  };
  return <div className="page-enter"><button className="back-button" onClick={onBack}><ArrowLeft size={16}/> All tournaments</button>
    <div className="page-heading compact"><div><span className="eyebrow">LET'S BUILD SOMETHING GREAT</span><h1>{existingTournament?'Add custom division':'Create a tournament'}</h1><p>{existingTournament
      ? 'Set up another independent division with its own teams, pools and playoffs.'
      : 'Start with your tournament details, then name the first division and configure its games.'}</p></div></div>
    <form onSubmit={submit} className="builder-layout">
      <div className="builder-form">
      {!existingTournament && <section className="form-card"><div className="form-section-title"><span className="step-num">01</span><div><h2>The essentials</h2><p>Give your tournament a name, sport and date.</p></div></div>
        <div className="field"><label htmlFor="t-name">Tournament name</label><input id="t-name" value={input.name} required maxLength={120} placeholder="e.g. Fall Classic Volleyball Open" onChange={e => update('name', e.target.value)}/></div>
        <div className="form-grid"><div className="field"><label htmlFor="sport">Sport</label><select id="sport" value={input.sport} onChange={e => update('sport', e.target.value)}><option>Volleyball</option><option>Generic</option></select></div>
          <div className="field"><label htmlFor="date">Tournament date</label><input id="date" type="date" value={input.startsOn} onChange={e => update('startsOn', e.target.value)}/></div></div>
      </section>}
      <section className="form-card"><div className="form-section-title"><span className="step-num">02</span><div><h2>Divisions</h2><p>{existingTournament
          ? 'Name this additional division. It will have its own teams, pools, results and playoffs.'
          : 'Name your first division. You can add more divisions from the tournament page while the tournament is still a draft.'}</p></div></div>
        <div className="field"><label htmlFor="division-name">Division name</label><input id="division-name" type="text" maxLength={100} required value={input.divisionName??''}
          onChange={e=>update('divisionName',e.target.value)} placeholder="e.g. Coed BB, Men's A, Intermediate"/>
          <span className="field-hint">Use any name you like—skill level, gender, both, or something else.</span></div>
      </section>
      <section className="form-card"><div className="form-section-title"><span className="step-num">03</span><div><h2>Teams & pools</h2><p>Add a team per line and choose how they'll be distributed.</p></div></div>
        <div className="field"><div className="field-inline"><label htmlFor="teams">Team names</label><button type="button" className="text-link" onClick={() => {setTeamText(sampleTeams.join('\n'));update('poolCount',4);}}>Use 16 sample teams <ArrowUpRight size={13}/></button></div>
          <textarea id="teams" rows={7} value={teamText} onChange={e => setTeamText(e.target.value)} placeholder={'Eagles\nWolves\nFalcons\nBears'}/><span className="field-hint">{teams.length} / 64 teams entered. Their order is their initial seed order.</span></div>
        <div className="form-grid"><div className="field"><label htmlFor="poolCount">Number of pools</label><input id="poolCount" type="number" min={1} max={32} value={input.poolCount} onChange={e => update('poolCount',Number(e.target.value))}/></div>
          <div className="field"><label htmlFor="seeding">Pool distribution</label><select id="seeding" value={input.seedMode} onChange={e => update('seedMode',e.target.value as 'snake'|'random')}><option value="snake">Seeded · snake</option><option value="random">Random assignment</option></select></div></div>
      </section>
      <section className="form-card"><div className="form-section-title"><span className="step-num">04</span><div><h2>Game format</h2><p>Configure pool-play scoring and playoff brackets for this division.</p></div></div>
        <div className="form-grid"><div className="field"><label htmlFor="sets">Sets per pool matchup</label><select id="sets" value={input.poolSets} onChange={e => update('poolSets', Number(e.target.value) as 1|2)}><option value={1}>1 fixed set</option><option value={2}>2 fixed sets (1–1 allowed)</option></select></div>
          <div className="field"><label htmlFor="points">Points to win a set</label><input id="points" type="number" min={1} max={100} value={input.targetPoints} onChange={e => update('targetPoints',Number(e.target.value))}/></div></div>
        <label className="checkbox-row"><input type="checkbox" checked={input.winByTwo} onChange={e => setInput(old=>({...old, winByTwo:e.target.checked, pointCap:e.target.checked ? old.pointCap : null}))}/><span><strong>Win by two points</strong><small>Sets continue beyond the target until a team leads by two.</small></span></label>
        <label className="checkbox-row"><input type="checkbox" checked={input.pointCap != null} onChange={e => update('pointCap', e.target.checked ? Math.max(input.targetPoints + 1, 25) : null)}/><span><strong>Use a point cap</strong><small>At the cap, a one-point lead wins (e.g., 25–24).</small></span></label>
        {input.pointCap != null && <div className="field"><label htmlFor="default-cap">Default point cap</label>
          <input id="default-cap" type="number" min={input.targetPoints + 1} max={999} value={input.pointCap} onChange={e => update('pointCap', Number(e.target.value))}/></div>}
        <div className="subheading">SCORING BY POOL</div>
        <p className="field-hint">All pools use the defaults above unless overridden. For example, Pools A/B can play to 21 while Pool C plays to 25.</p>
        {Array.from({length: usablePools},(_,i) => {
          const override = input.poolScoring?.[i];
          const enabled = override?.enabled ?? false;
          const rules = override ?? {targetPoints:input.targetPoints, winByTwo:input.winByTwo, pointCap:input.pointCap ?? null, enabled:false};
          return <div className="bracket-config-row" key={i}>
            <label className="checkbox-row"><input type="checkbox" checked={enabled}
              onChange={e => updatePoolRule(i, e.target.checked ? {
                enabled: true, targetPoints:input.targetPoints, winByTwo:input.winByTwo, pointCap:input.pointCap ?? null,
              } : {enabled:false})}/>
              <span><strong>Pool {String.fromCharCode(65+i)} ({poolSizes[i] ?? 0} teams)</strong><small>{enabled ? 'Custom scoring' : 'Use default scoring'}</small></span></label>
            {enabled && <div className="form-grid">
              <div className="field"><label htmlFor={`pool-points-${i}`}>Points to win</label>
                <input id={`pool-points-${i}`} type="number" min={1} max={100} value={rules.targetPoints}
                  onChange={e => updatePoolRule(i,{targetPoints:Number(e.target.value)})}/></div>
              <div className="field"><label htmlFor={`pool-cap-${i}`}>Point cap (optional)</label>
                <input id={`pool-cap-${i}`} type="number" min={rules.targetPoints+1} max={999}
                  value={rules.pointCap ?? ''} placeholder="No cap"
                  onChange={e => updatePoolRule(i,{pointCap:e.target.value.trim()===''?null:Number(e.target.value)})}/></div>
              <label className="checkbox-row"><input type="checkbox" checked={rules.winByTwo}
                onChange={e => updatePoolRule(i,{winByTwo:e.target.checked, pointCap:e.target.checked ? rules.pointCap : null})}/>
                <span><strong>Win by two</strong></span></label>
            </div>}
          </div>;
        })}
        <p className="field-hint">When pools use different point targets, compare cross-pool teams primarily by set win percentage; raw total points are not comparable.</p>
        <div className="subheading">PLAYOFF PLANNING</div>
        <div className="field">
          <label htmlFor="playoff-mode">Playoff structure</label>
          <select id="playoff-mode" value={playoffMode} onChange={e => selectPlayoffMode(e.target.value as 'championship'|'multi'|'none')}>
            <option value="championship">One Championship bracket (default)</option>
            <option value="multi">Multiple brackets (Gold / Silver / custom)</option>
            <option value="none">No playoffs — pool standings only</option>
          </select>
        </div>
        {input.playoffBrackets.map((bracket, index) => <div key={index} className="bracket-config-row">
          <div className="form-grid">
            <div className="field"><label htmlFor={`bracket-name-${index}`}>Bracket name</label><input id={`bracket-name-${index}`} value={bracket.name} maxLength={60} onChange={e=>editBracket(index,{name:e.target.value})}/></div>
            <div className="field"><label htmlFor={`bracket-format-${index}`}>Elimination format</label><select id={`bracket-format-${index}`} value={bracket.format} onChange={e=>editBracket(index,{format:e.target.value as 'single'|'double'})}><option value="single">Single elimination</option><option value="double">Double elimination</option></select></div>
          </div>
          {bracket.format==='double' && <p className="field-hint">Supports 2–64 seeded teams per bracket, with automatic byes for non-power-of-two fields.</p>}
          {bracket.format==='double' && <label className="checkbox-row"><input type="checkbox" checked={bracket.bracketReset} onChange={e=>editBracket(index,{bracketReset:e.target.checked})}/><span><strong>Play a second grand final if needed</strong><small>If the losers' bracket finalist wins Grand Final 1, play Grand Final 2 to decide the champion.</small></span></label>}
          {playoffMode==='multi' && <button className="text-link remove-bracket" type="button" onClick={()=>update('playoffBrackets',input.playoffBrackets.filter((_,i)=>i!==index))}>Remove this bracket</button>}
        </div>)}
        {playoffMode==='multi' && input.playoffBrackets.length < 8 && <button type="button" className="button button-outline" onClick={addBracket}><Plus size={15}/> Add playoff bracket</button>}
        {playoffMode==='none' && <p className="field-hint">No playoff bracket will be created. The tournament will finish with approved pool standings.</p>}
        <div className="info-inline"><ShieldCheck size={17}/> Bracket seeds and round scoring settings are approved after pool play, before playoff matches are generated.</div>
      </section>
      {localError && <div className="form-error" role="alert">{localError}</div>}
      <div className="builder-buttons"><button type="button" className="button button-outline" onClick={onBack}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Creating…' : existingTournament?'Add division':'Create tournament'} <ArrowRight size={17}/></button></div>
    </div><aside className="builder-side"><div className="summary-card"><span className="eyebrow">LIVE PREVIEW</span><h3>{input.name.trim() || 'Your tournament'}</h3><p><strong>Division:</strong> {input.divisionName?.trim()||'Untitled'}</p><p>{input.sport} · {input.startsOn || 'Date TBD'}</p>
        <div className="summary-metrics"><div><strong>{teams.length}</strong><span>Teams</span></div><div><strong>{input.poolCount}</strong><span>Pools</span></div><div><strong>{matchCount}</strong><span>Pool matches</span></div><div><strong>{matchCount*input.poolSets}</strong><span>Pool sets</span></div></div>
        <div className="summary-label">POOLS AT A GLANCE</div>
        {teams.length >= 2 && input.poolCount <= teams.length / 2 ? <div className="preview-pools">{poolSizes.map((n, i) => <div key={i}><span>Pool {String.fromCharCode(65+i)}</span><strong>{n} teams</strong></div>)}</div> : <div className="preview-placeholder">Add enough teams to preview pool distribution.</div>}
        <div className="summary-divider"/>
        <div className="summary-label">PLANNED PLAYOFFS</div>
        {input.playoffBrackets.length ? input.playoffBrackets.map((b,i)=><div className="preview-formats" key={i}><span><Medal size={16}/>{b.name || 'Unnamed bracket'}</span><strong>{titleCase(b.format)} elim</strong></div>) : <p className="field-hint">Pool play only — no brackets</p>}
      </div><p className="sidebar-tip"><Sparkles size={17}/> You can create a draft first, review everything, and publish when ready.</p></aside></form>
  </div>;
}

function TournamentPage({ bundle, isOwner, busy, onBack, onStatus, onScore, onDelete, onFinalize, onPlayoffScore, onSelectDivision, onAddDivision }: {
  bundle: TournamentBundle; isOwner: boolean; busy: boolean; onBack: () => void;
  onStatus: (next: 'published'|'pool_play') => Promise<void>; onScore: (match: Match, scores: Array<[number,number]>) => Promise<void>;
  onDelete: () => Promise<void>;
  onSelectDivision: (divisionId:string)=>void; onAddDivision:()=>void;
  onFinalize: (assignments: BracketAssignments, rules: RoundRulesByBracket, noByes: boolean) => Promise<void>;
  onPlayoffScore: (match: PlayoffMatch, scores: SetScore[]) => Promise<void>;
}) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [activePool, setActivePool] = useState(bundle.pools[0]?.id ?? '');
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [copied, setCopied] = useState(false);
  const t = bundle.tournament;
  const complete = bundle.matches.filter(m => m.status === 'completed').length;
  const scheduled = bundle.matches.length;
  const teamName = (id: string) => bundle.teams.find(x => x.id === id)?.name ?? 'Unknown team';
  const shareUrl = `${window.location.origin}${window.location.pathname}?t=${encodeURIComponent(t.id)}${bundle.selectedCompetitionDivisionId?`&d=${encodeURIComponent(bundle.selectedCompetitionDivisionId)}`:''}`;
  const publicReady = t.status !== 'draft';
  const firstPool = bundle.pools.some(p => p.id === activePool) ? activePool : bundle.pools[0]?.id;
  return <div className="page-enter"><button className="back-button" onClick={onBack}><ArrowLeft size={16}/> All tournaments</button>
    <div className="detail-heading"><div><div className="title-overline"><span className={`status-tag ${t.status === 'draft' ? 'muted' : 'live'}`}>{statusLabel(t.status)}</span><span className="overline-separator">•</span><span>{t.sport}</span></div>
      <h1>{t.name}</h1><p><CalendarDays size={16}/>{t.starts_on ?? 'Date not set'} <span className="dot-sep">·</span> {bundle.teams.length} teams <span className="dot-sep">·</span> {bundle.pools.length} pools</p></div>
      <div className="detail-actions">{isOwner && publicReady && <button className="button button-outline" onClick={async () => {await navigator.clipboard.writeText(shareUrl);setCopied(true);window.setTimeout(()=>setCopied(false),2000);}}>{copied ? <Check size={16}/> : <Copy size={16}/>} {copied ? 'Copied' : 'Copy public link'}</button>}
        {isOwner && t.status === 'draft' && <button className="button button-primary" disabled={busy} onClick={() => onStatus('published')}><ExternalLink size={16}/> Publish tournament</button>}
        {isOwner && t.status === 'published' && <button className="button button-primary" disabled={busy} onClick={() => onStatus('pool_play')}><Flag size={16}/> Start pool play</button>}
      </div></div>
    <section className="division-toolbar white-card" aria-label="Competition divisions">
      <div className="division-toolbar-heading"><strong>Competition divisions</strong>
        <span>Custom divisions have independent pools, scores, standings and playoffs.</span></div>
      <div className="division-tabs">
        {(bundle.competitionDivisions??[{id:bundle.selectedCompetitionDivisionId??'local',name:bundle.competitionDivisionName??'Open',status:t.status,sort_order:0,tournament_id:t.id}]).map(d=><button
          key={d.id} type="button" className={d.id===bundle.selectedCompetitionDivisionId?'active':''}
          aria-current={d.id===bundle.selectedCompetitionDivisionId?'page':undefined}
          onClick={()=>onSelectDivision(d.id)}>{d.name}</button>)}
        {isOwner && t.status==='draft' && !demoMode && <button type="button" className="division-add" onClick={onAddDivision}><Plus size={16}/> Add division</button>}
      </div>
    </section>
    {demoMode && <div className="demo-banner"><LockKeyhole size={17}/><span>Demo mode: your tournament is saved in this browser only. Public links and multi-device access require a connected Supabase project.</span></div>}
    <div className="detail-metrics"><Metric icon={<UsersRound size={20}/>} label="Teams" value={String(bundle.teams.length)} hint="Registered"/><Metric icon={<ListChecks size={20}/>} label="Pool matchups" value={String(scheduled)} hint={`${scheduled*t.pool_sets} scheduled sets`}/><Metric icon={<CheckCircle2 size={20}/>} label="Results entered" value={`${complete}/${scheduled}`} hint={`${scheduled ? Math.round(100*complete/scheduled) : 0}% completed`}/></div>
    <div className="tabs" role="tablist" aria-label="Tournament sections">{([['overview','Overview'],['pools','Pool play & scores'],['playoffs','Playoffs']] as const).map(([key,label]) => <button key={key} role="tab" aria-selected={tab===key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>)}</div>
    {tab === 'overview' && <div className="overview-layout"><div className="white-card"><div className="card-heading"><h2>Competition structure</h2><span className="subtle-tag">Ready to run</span></div><p className="section-desc">Your round-robin schedule has been generated automatically.</p>
      <div className="structure-rows"><div><span className="structure-icon"><UsersRound size={19}/></span><div><strong>Pool play</strong><small>{bundle.pools.length} pools · {t.pool_sets} fixed set{t.pool_sets>1?'s':''} per matchup · first to {t.target_points}{t.win_by_two ? ', win by 2' : ''}</small></div><CheckCircle2 size={19} className="ok"/></div>
        {bundle.divisions.length ? bundle.divisions.map(d=><div key={d.id}><span className="structure-icon"><Medal size={19}/></span><div><strong>{d.name} bracket</strong><small>{titleCase(d.format)} elimination · future bracket</small></div><span className="soon">PLANNED</span></div>) : <div><span className="structure-icon"><Medal size={19}/></span><div><strong>Pool-only competition</strong><small>No playoff brackets configured.</small></div></div>}</div>
      <button className="button button-outline" onClick={() => setTab('pools')}>View pools and schedule <ArrowRight size={16}/></button></div>
      <div className="white-card"><div className="card-heading"><h2>Your pools</h2><span className="subtle-tag">{bundle.pools.length} total</span></div>
        <div className="pool-summary-list">{bundle.pools.map(p => <button key={p.id} onClick={() => {setActivePool(p.id);setTab('pools');}}><span className="pool-letter">{p.label.slice(-1)}</span><div><strong>{p.label}</strong><small>{bundle.poolTeams.filter(x=>x.pool_id===p.id).length} teams · {bundle.matches.filter(x=>x.pool_id===p.id).length} matches</small></div><ChevronRight size={17}/></button>)}</div>
      </div></div>}
    {tab === 'pools' && <div className="pool-play-area"><div className="pool-switcher">{bundle.pools.map(pool => <button key={pool.id} className={firstPool===pool.id?'active':''} onClick={()=>setActivePool(pool.id)}>{pool.label}</button>)}</div>
      {bundle.pools.filter(p=>p.id===firstPool).map(pool => <PoolPanel key={pool.id} pool={pool} bundle={bundle} isOwner={isOwner} teamName={teamName} onEdit={setEditingMatch}/>)}</div>}
    {tab === 'playoffs' && <PlayoffPanel key={`${bundle.tournament.id}:${bundle.selectedCompetitionDivisionId??''}`} bundle={bundle}
      isOwner={isOwner} busy={busy} onFinalize={onFinalize}
      onPlayoffScore={onPlayoffScore}/>}
    {isOwner && tab === 'overview' && <div className="tournament-delete-area">
      <span>Remove this tournament and all its results permanently.</span>
      <button type="button" className="danger-text" disabled={busy} onClick={onDelete}>Permanently delete tournament</button>
    </div>}
    {editingMatch && <ScoreModal key={editingMatch.id} match={editingMatch} bundle={bundle} busy={busy} onClose={()=>setEditingMatch(null)} teamName={teamName}
      onSave={async pairs=>{await onScore(editingMatch,pairs);setEditingMatch(null);}}/>}
  </div>;
}


/**
 * Draw a genuine single-elimination tree rather than unrelated columns.
 *
 * Each later-round match is centered between its two feeder matches. SVG
 * elbows visually connect them. Geometry is derived only from the number of
 * rounds/matches; scores, team names and advancement are still provided by the
 * existing tournament engine and Supabase. This component changes display only.
 *
 * The horizontal scroll area also makes large brackets usable on small screens.
 */
type DiagramCard = {
  id: string;
  content: React.ReactNode;
  state?: 'scheduled' | 'ready' | 'completed' | 'bye';
};

type DiagramRound = {
  number: number;
  cards: DiagramCard[];
};

function EliminationBracket({ label, rounds, cardHeight = 154 }: { label: string; rounds: DiagramRound[]; cardHeight?: number }) {
  if (!rounds.length) return null;

  // Consistent dimensions keep every connector anchored to a match midpoint.
  const cardWidth = 264;
  const gapWidth = 78;
  const rowPitch = cardHeight + 24;
  const titleHeight = 48;
  const firstRoundCount = Math.max(1, rounds[0].cards.length);
  const width = rounds.length * cardWidth + (rounds.length - 1) * gapWidth;
  const height = titleHeight + firstRoundCount * rowPitch;
  const cardCenter = (roundIndex: number, matchIndex: number) =>
    titleHeight + (matchIndex + 0.5) * (2 ** roundIndex) * rowPitch;

  // Conventional bracket elbows: two source matches join a single next-round
  // match. Lines stay behind cards and do not capture mouse/touch input.
  const connectors = rounds.slice(0, -1).flatMap((round, roundIndex) => {
    const nextRound = rounds[roundIndex + 1];
    const startX = roundIndex * (cardWidth + gapWidth) + cardWidth;
    const elbowX = startX + gapWidth * 0.48;
    const endX = startX + gapWidth;
    return nextRound.cards.flatMap((_, matchIndex) => {
      const sourceA = matchIndex * 2;
      const sourceB = sourceA + 1;
      if (sourceB >= round.cards.length) return [];
      const topY = cardCenter(roundIndex, sourceA);
      const bottomY = cardCenter(roundIndex, sourceB);
      const destinationY = cardCenter(roundIndex + 1, matchIndex);
      // Draw BOTH feeder arms into the same vertical join. The original path
      // drew the upper arm and vertical join, but never reached the lower card.
      // A second, separate segment runs from the join to the next-round card.
      return [{
        key: `${roundIndex}-${matchIndex}`,
        d: `M ${startX} ${topY} H ${elbowX} V ${bottomY} H ${startX} M ${elbowX} ${destinationY} H ${endX}`,
      }];
    });
  });

  return <div className="bracket-scroll" role="region" aria-label={label} tabIndex={0}>
    <div className="elimination-tree" style={{ width, height }}>
      <svg className="bracket-connectors" width={width} height={height}
        viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        {connectors.map(connector => <path key={connector.key} d={connector.d}/>)}
      </svg>
      {rounds.map((round, roundIndex) => <section className="bracket-column"
        key={round.number}
        aria-label={roundIndex === rounds.length - 1 ? 'Final' : `Round ${round.number}`}
        style={{ left: roundIndex * (cardWidth + gapWidth), width: cardWidth }}>
        <h3>{roundIndex === rounds.length - 1 ? 'Final' : `Round ${round.number}`}</h3>
        {round.cards.map((card, matchIndex) => <div key={card.id}
          className={`bracket-match bracket-match--${card.state ?? 'scheduled'}`}
          style={{ top: cardCenter(roundIndex, matchIndex) - cardHeight / 2, height: cardHeight }}>
          {card.content}
        </div>)}
      </section>)}
    </div>
  </div>;
}

/**
 * Double-elimination display: two complete HORIZONTAL round trees and one
 * championship panel. The lower path alternates between receiving winners from
 * the preceding losers' round and teams dropping from the upper bracket.
 * The diagram is display-only: Supabase owns actual match progression.
 */
function DoubleEliminationMatches({bracketName,matches,bundle,teamName,busy,isOwner,onEnter}:{
  bracketName:string;matches:PlayoffMatch[];bundle:TournamentBundle;
  teamName:(id:string|null)=>string;busy:boolean;isOwner:boolean;onEnter:(match:PlayoffMatch)=>void;
}) {
  const scoreCard = (match:PlayoffMatch): React.ReactNode => {
    const allScores=(bundle.playoffScores??[]).filter(s=>s.match_id===match.id);
    const winsA=allScores.filter(s=>s.score_a>s.score_b).length;
    const winsB=allScores.filter(s=>s.score_b>s.score_a).length;
    const rule=effectiveRoundRule(bundle,match.bracket_id,match.round_number);
    const ready=match.status==='scheduled' && !!match.team_a_id && !!match.team_b_id
      && bundle.tournament.status==='playoffs';
    const label=match.playoff_phase==='grand'?'Grand Final 1'
      :match.playoff_phase==='reset'?'Grand Final 2 (if needed)'
      :`Match ${match.playoff_phase==='lower'?match.sequence%100:match.sequence}`;
    return <>
      <div className="double-match-label">{label}</div>
      <div className={`bracket-team ${winsA>winsB?'bracket-team--winner':''}`}>
        <span>{teamName(match.team_a_id)}</span><strong>{allScores.length?winsA:''}</strong>
      </div>
      <div className={`bracket-team ${winsB>winsA?'bracket-team--winner':''}`}>
        <span>{teamName(match.team_b_id)}</span><strong>{allScores.length?winsB:''}</strong>
      </div>
      <small className="bracket-match-status">{match.status==='completed'
        ? `${rule.best_of===1?'Single set':`Best of ${rule.best_of}`} · ${allScores.map(s=>`${s.score_a}–${s.score_b}`).join(' / ')}`
        :match.status==='bye'?'Automatic bye · no score required'
        :ready?`${rule.best_of===1?'Single set':`Best of ${rule.best_of}`} · Ready for score`:'Waiting for previous results'}</small>
      {(ready || (isOwner && match.status==='completed')) &&
        <button className="score-action" type="button" disabled={busy}
          onClick={()=>onEnter(match)}>{match.status==='completed'?'Edit score':'Enter score'} <ChevronRight size={14}/></button>}
    </>;
  };
  const upper=matches.filter(m=>(m.playoff_phase??'upper')==='upper');
  const upperRounds=[...new Set(upper.map(m=>m.round_number))].sort((a,b)=>a-b).map(n=>({
    number:n,
    cards:upper.filter(m=>m.round_number===n).sort((a,b)=>a.sequence-b.sequence).map(m=>({
      id:m.id,content:scoreCard(m),state:m.status==='scheduled'&&m.team_a_id&&m.team_b_id?'ready' as const:m.status==='forfeit'?'scheduled' as const:m.status,
    })),
  }));
  const lower=matches.filter(m=>m.playoff_phase==='lower');
  const lowerStages=[...new Set(lower.map(m=>Math.floor(m.sequence/100)))].sort((a,b)=>a-b);
  const lowerRounds=lowerStages.map(n=>({
    number:n,
    matches:lower.filter(m=>Math.floor(m.sequence/100)===n).sort((a,b)=>a.sequence-b.sequence),
  }));
  const finals=matches.filter(m=>m.playoff_phase==='grand'||m.playoff_phase==='reset')
    .sort((a,b)=>a.playoff_phase==='grand'?-1:b.playoff_phase==='grand'?1:0);
  const cardWidth=270, cardHeight=196, gapWidth=65, pitch=220, heading=56;
  const mostMatches=Math.max(1,...lowerRounds.map(r=>r.matches.length));
  const width=lowerRounds.length*cardWidth+Math.max(0,lowerRounds.length-1)*gapWidth;
  const height=heading+mostMatches*pitch;
  const center=(roundIndex:number,matchIndex:number) =>
    heading+(matchIndex+0.5)*mostMatches*pitch/lowerRounds[roundIndex].matches.length;
  const connections=lowerRounds.slice(0,-1).flatMap((round,i)=>{
    const following=lowerRounds[i+1];
    const count=round.matches.length;
    const nextCount=following.matches.length;
    if (count!==nextCount && count!==nextCount*2) return [];
    const sx=i*(cardWidth+gapWidth)+cardWidth;
    const elbowX=sx+gapWidth/2;
    const dx=sx+gapWidth;
    return round.matches.map((m,j)=>{
      const targetIndex=count===nextCount?j:Math.floor(j/2);
      const a=center(i,j), b=center(i+1,targetIndex);
      return {key:m.id,d:`M ${sx} ${a} H ${elbowX} V ${b} H ${dx}`};
    });
  });
  return <div className="double-bracket-board" aria-label={`${bracketName} double-elimination bracket`}>
    <section className="double-bracket-section">
      <h3>Winners' bracket</h3>
      <p>Winners move right. The first loss drops a team into the losers' bracket.</p>
      <EliminationBracket label={`${bracketName} winners' bracket`} rounds={upperRounds} cardHeight={196}/>
    </section>
    {lowerRounds.length>0 && <section className="double-bracket-section">
      <h3>Losers' bracket</h3>
      <p>Rounds progress left to right. A second loss eliminates a team; teams from the winners' bracket join at designated rounds.</p>
      <div className="bracket-scroll" role="region" tabIndex={0} aria-label={`${bracketName} losers' bracket`}>
        <div className="lower-bracket-tree" style={{width,height}}>
          <svg className="bracket-connectors" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            {connections.map(c=><path key={c.key} d={c.d}/>)}
          </svg>
          {lowerRounds.map((round,i)=><section className="bracket-column" key={round.number}
            aria-label={`Losers' round ${round.number}`} style={{left:i*(cardWidth+gapWidth),width:cardWidth}}>
            <h3>Losers' round {round.number}</h3>
            {round.matches.map((m,j)=><div key={m.id}
              className={`bracket-match bracket-match--${m.status}`}
              style={{top:center(i,j)-cardHeight/2,height:cardHeight}}>{scoreCard(m)}</div>)}
          </section>)}
        </div>
      </div>
    </section>}
    <section className="double-bracket-section">
      <h3>Championship</h3>
      <p>The undefeated finalist faces the survivor of the losers' bracket.</p>
      <div className="double-finals">
        {finals.map(m=><div className="bracket-match" key={m.id}>{scoreCard(m)}</div>)}
        {!finals.length && <p>The championship match will appear when the bracket is generated.</p>}
      </div>
    </section>
  </div>;
}

/**
 * The organizer reviews every pool result and explicitly approves the final
 * participants and seeds. Until confirmation, all assignments are local-only.
 * The SQL RPC rechecks ownership, all results, and all team IDs atomically.
 */
function PlayoffPanel({ bundle, isOwner, busy, onFinalize, onPlayoffScore }: {
  bundle: TournamentBundle; isOwner: boolean; busy: boolean;
  onFinalize: (assignments: BracketAssignments, rules: RoundRulesByBracket, noByes: boolean) => Promise<void>;
  onPlayoffScore: (match: PlayoffMatch, scores: SetScore[]) => Promise<void>;
}) {
  const [assignments, setAssignments] = useState<BracketAssignments>(() => suggestedAssignments(bundle));
  const [qualification, setQualification] = useState<QualificationRule>({
    mode:'all', topPerPool:2, nextPlaceWildcards:0, overallCount:8,
  });
  const [confirmed, setConfirmed] = useState(false);
  const [requireByeFree, setRequireByeFree] = useState(false);
  const [editedRoundRules, setEditedRoundRules] = useState<Record<string,Record<number,PlayoffRoundRule>>>({});
  const getRule = (bracketId:string, round:number): PlayoffRoundRule => editedRoundRules[bracketId]?.[round]
    ?? effectiveRoundRule(bundle,bracketId,round);
  const changeRoundRule = (bracketId:string, round:number, patch:Partial<PlayoffRoundRule>) => {
    setConfirmed(false);
    setEditedRoundRules(old=>({
      ...old,
      [bracketId]: {...old[bracketId], [round]: {...(old[bracketId]?.[round] ?? getRule(bracketId,round)),...patch}},
    }));
  };
  const buildRules = (): RoundRulesByBracket => Object.fromEntries(
    bundle.divisions.map(bracket=>[bracket.id,Array.from({length:playoffRoundCount((assignments[bracket.id]??[]).length,bracket.format)},
      (_,i)=>getRule(bracket.id,i+1))]),
  );
  const [activeMatch, setActiveMatch] = useState<PlayoffMatch | null>(null);
  const [saveError, setSaveError] = useState('');
  const t = bundle.tournament;
  const complete = bundle.matches.filter(m => m.status === 'completed').length;
  const allComplete = complete === bundle.matches.length;
  const running = t.status === 'playoffs' || t.status === 'completed';
  const teamName = (id: string | null): string => id
    ? bundle.teams.find(team => team.id === id)?.name ?? 'Unknown team'
    : 'TBD';
  const brackets = [...bundle.divisions].sort((a,b)=>a.sort_order-b.sort_order);
  const assignmentError = validateAssignments(bundle, assignments)
    || (requireByeFree ? byeFreeAssignmentsError(bundle, assignments) : null);
  const scoringError = Object.values(buildRules()).flat().map(roundRuleError).find(Boolean);
  const canFinalize = isOwner && !demoMode && t.status === 'pool_play'
    && allComplete && !assignmentError && !scoringError && confirmed && !busy;

  const moveTeam = (teamId: string, fromId: string, toId: string) => {
    if (fromId === toId) return;
    setConfirmed(false);
    setAssignments(old => ({
      ...old,
      [fromId]: old[fromId].filter(id => id !== teamId),
      [toId]: [...old[toId],teamId],
    }));
  };
  const byeSuggestion = suggestedByeFreeWildcards(bundle, qualification.topPerPool);
  const applyQualification = () => {
    const adjusted = requireByeFree && qualification.mode==='per_pool' && byeSuggestion.possible
      ? {...qualification, nextPlaceWildcards:byeSuggestion.count}
      : qualification;
    if (requireByeFree && qualification.mode==='per_pool' && !byeSuggestion.possible) {
      setSaveError('Not enough next-place teams to fill a bracket without byes. Change automatic qualifiers, bracket count, or allow byes.');
      return;
    }
    setQualification(adjusted);
    const selected=qualifiedTeamIds(bundle, adjusted);
    setAssignments(distributeQualifiers(bundle,selected));
    setConfirmed(false);
  };
  const selectedIds=new Set(Object.values(assignments).flat());
  const excludedTeams=rankedPoolTeams(bundle).filter(id=>!selectedIds.has(id));
  const pendingQualifiers=qualifiedTeamIds(bundle,qualification);
  const restoreExcluded=(teamId:string,bracketId:string) => {
    setConfirmed(false);
    setAssignments(old=>({...old,[bracketId]:[...(old[bracketId]??[]),teamId]}));
  };
  const excludeTeam=(teamId:string,bracketId:string) => {
    setConfirmed(false);
    setAssignments(old=>({...old,[bracketId]:(old[bracketId]??[]).filter(id=>id!==teamId)}));
  };
  const reorder = (bracketId: string, index: number, direction: number) => {
    setConfirmed(false);
    setAssignments(old => {
      const next = [...old[bracketId]];
      const other = index + direction;
      if (other < 0 || other >= next.length) return old;
      [next[index], next[other]] = [next[other], next[index]];
      return {...old, [bracketId]: next};
    });
  };
  const finalize = async () => {
    setSaveError('');
    if (!canFinalize) return;
    const message = brackets.length
      ? `Finalize all pool results and generate ${brackets.length} playoff bracket(s)?\n\nPool scores will lock. Playoff seeding cannot be changed once matches begin.`
      : 'Approve final pool standings and complete this pool-only tournament? Pool scores will lock.';
    if (!window.confirm(message)) return;
    try { await onFinalize(assignments,buildRules(),requireByeFree); }
    catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); }
  };

  return <div className="playoff-stack">
    <div className="white-card playoff-review-card">
      <div className="card-heading"><h2>{running ? 'Playoff brackets' : 'Organizer pool review'}</h2>
        <span className="subtle-tag">{complete} of {bundle.matches.length} pool matches</span></div>
      <p className="review-format-note">{running
        ? 'Pool rankings are finalized. Follow results and advancing teams below.'
        : allComplete ? 'All pool match scores are recorded. Review rankings and seed assignments before locking the results.'
          : 'Pool play is in progress. Playoff assignments below are provisional until every pool match is recorded.'}</p>
      <div className="review-standings">
        {bundle.pools.map(pool => <div className="review-pool" key={pool.id}>
          <h3>{pool.label}</h3>
          {standingsForPool(bundle,pool.id).map(row => <div className="review-standing" key={row.team.id}>
            <span>{row.rank}. {row.team.name}</span>
            <small>{row.wins}–{row.losses} sets · {(row.winPct * 100).toFixed(1)}%</small>
          </div>)}
        </div>)}
      </div>
    </div>

    {!running && isOwner && brackets.length>0 && <div className="white-card playoff-review-card">
      <div className="card-heading"><h2>Who qualifies for playoffs?</h2>
        <span className="subtle-tag">{selectedIds.size} of {bundle.teams.length} currently selected</span></div>
      <p className="review-format-note">Choose how teams qualify after pool play. You can then adjust bracket assignments and seeds manually. Non-qualifying teams keep their pool results but do not enter playoffs.</p>
      <div className="qualification-controls">
        <label>Qualification method
          <select value={qualification.mode} onChange={e=>setQualification(old=>({...old,mode:e.target.value as QualificationRule['mode']}))}>
            <option value="all">Everyone advances (default)</option>
            <option value="per_pool">Top teams from each pool + wildcards</option>
            <option value="overall">Best X teams overall</option>
          </select>
        </label>
        {qualification.mode==='per_pool' && <>
          <label>Automatic places per pool
            <input type="number" min="0" max={Math.max(1,...bundle.pools.map(p=>standingsForPool(bundle,p.id).length))}
              value={qualification.topPerPool} onChange={e=>setQualification(old=>({...old,topPerPool:Math.max(0,Number(e.target.value))}))}/>
          </label>
          <label>Best next-place wildcards
            <input type="number" min="0" max={bundle.pools.length} value={qualification.nextPlaceWildcards}
              onChange={e=>setQualification(old=>({...old,nextPlaceWildcards:Math.max(0,Number(e.target.value))}))}/>
          </label>
        </>}
        {qualification.mode==='overall' && <label>Total teams advancing
          <input type="number" min="2" max={bundle.teams.length} value={qualification.overallCount}
            onChange={e=>setQualification(old=>({...old,overallCount:Math.max(0,Number(e.target.value))}))}/>
        </label>}
      </div>
      <label className="checkbox-row qualifier-no-byes"><input type="checkbox" checked={requireByeFree}
        onChange={e=>{setRequireByeFree(e.target.checked);setConfirmed(false);}} />
        <span><strong>Require full playoff brackets (no first-round byes)</strong></span>
      </label>
      {requireByeFree && qualification.mode==='per_pool' && <p className="review-format-note">
        {byeSuggestion.possible
          ? `To fill ${bundle.divisions.length} bracket(s) with ${byeSuggestion.target} total entrants, select ${byeSuggestion.count} best next-place wildcard team(s). This count will be applied automatically.`
          : `A full bracket would require ${byeSuggestion.count} wildcard(s), but only ${byeSuggestion.available} next-place teams are available. Change the cutoff or allow byes.`}
      </p>}
      {requireByeFree && qualification.mode!=='per_pool' && <p className="review-format-note">
        Each configured playoff bracket must contain 2, 4, 8, 16, 32 or 64 entrants. Adjust the cutoff or manual seeds to meet this requirement.
      </p>}
      <div className="qualifier-actions">
        <span>{pendingQualifiers.length} would advance based on this rule.</span>
        <button className="button button-outline" type="button" onClick={applyQualification}>
          Apply qualifiers to playoff brackets
        </button>
      </div>
      {qualification.mode==='per_pool' && <p className="review-format-note">
        Example: Top 2 per pool + 2 wildcards means automatic 1st/2nd-place qualifiers, plus the two best 3rd-place teams. Wildcards are compared by set-win percentage, point ratio, then average point difference. Review ties across uneven pools before finalizing.
      </p>}
      {!!excludedTeams.length && <div className="excluded-teams">
        <h3>Not advancing ({excludedTeams.length})</h3>
        {excludedTeams.map(id=><div key={id} className="excluded-team"><span>{teamName(id)}</span>
          <select aria-label={`Restore ${teamName(id)} to playoffs`} value=""
            onChange={e=>{if(e.target.value) restoreExcluded(id,e.target.value);}}>
            <option value="">Add to bracket…</option>
            {brackets.map(bracket=><option key={bracket.id} value={bracket.id}>{bracket.name}</option>)}
          </select>
        </div>)}
      </div>}
    </div>}

    {!running && brackets.length===0 && <div className="white-card playoff-review-card">
      <h2>Pool play only</h2>
      <p className="review-format-note">No playoff brackets were configured. Once every result is correct, the organizer can confirm final standings and complete the tournament.</p>
    </div>}

    {!running && brackets.map(bracket => {
      const ids = assignments[bracket.id] ?? [];
      const preview = ids.length >= 2
        ? previewSingleElimination(ids) : [];
      return <div className="white-card playoff-review-card" key={bracket.id}>
        <div className="card-heading"><div><h2>{bracket.name} bracket</h2>
          <p className="section-desc">{bracket.format === 'single' ? 'Single elimination' : 'Double elimination · 2–64 teams'}</p></div>
          <span className="subtle-tag">{ids.length} teams</span></div>
        {isOwner && !demoMode && t.status === 'pool_play' && <div className="seeding-list">
          <p className="review-format-note">Choose brackets for advancing teams, use arrows to adjust seeding, or × to exclude a team. Seed 1 is highest.</p>
          {ids.map((id,index) => <div className="seeding-row" key={id}>
            <strong>#{index+1} · {teamName(id)}</strong>
            <div className="seed-actions">
              <select aria-label={`Bracket for ${teamName(id)}`} value={bracket.id}
                onChange={e=>moveTeam(id,bracket.id,e.target.value)}>
                {brackets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <button type="button" aria-label={`Move ${teamName(id)} up`} disabled={index===0}
                onClick={()=>reorder(bracket.id,index,-1)}>↑</button>
              <button type="button" aria-label={`Move ${teamName(id)} down`} disabled={index===ids.length-1}
                onClick={()=>reorder(bracket.id,index,1)}>↓</button>
              <button type="button" className="exclude-seed" aria-label={`Exclude ${teamName(id)} from playoffs`}
                title="Does not advance to playoffs" onClick={()=>excludeTeam(id,bracket.id)}>×</button>
            </div>
          </div>)}
        </div>}
        {isOwner && !running && ids.length>=2 && <div className="round-scoring-settings">
          <h3>Scoring by playoff round</h3>
          <p className="review-format-note">Each round can use one set, best of three, or best of five. Deciding-set rules apply only to the last possible set. In double elimination, losers' rounds inherit their corresponding winners' round settings.</p>
          {Array.from({length:playoffRoundCount(ids.length,bracket.format)},(_,i)=>i+1).map(round=>{
            const rule=getRule(bracket.id,round);
            const totalRounds=playoffRoundCount(ids.length,bracket.format);
            const upperRounds=totalRounds-2;
            const roundLabel=bracket.format==='double'
              ? round===upperRounds+1?'Grand Final 1'
                : round===upperRounds+2?'Grand Final 2 (if needed)'
                : `Winners round ${round} · corresponding losers rounds`
              : round===totalRounds?'Final':round===totalRounds-1?'Semifinals':`Round ${round}`;
            return <div className="round-scoring-row" key={round}>
              <div className="round-scoring-head"><strong>{roundLabel}</strong>
                <select aria-label={`${bracket.name} round ${round} match format`} value={rule.best_of}
                  onChange={e=>changeRoundRule(bracket.id,round,{best_of:Number(e.target.value) as 1|3|5})}>
                  <option value={1}>Single set</option><option value={3}>Best of 3</option><option value={5}>Best of 5</option>
                </select></div>
              <div className="round-scoring-fields">
                <label>Points / set<input type="number" min="1" max="100" value={rule.target_points}
                  onChange={e=>changeRoundRule(bracket.id,round,{target_points:Number(e.target.value)})}/></label>
                <label>Point cap (optional)<input type="number" min="1" max="999" placeholder="No cap" value={rule.point_cap??''}
                  onChange={e=>changeRoundRule(bracket.id,round,{point_cap:e.target.value===''?null:Number(e.target.value)})}/></label>
                <label className="compact-checkbox"><input type="checkbox" checked={rule.win_by_two}
                  onChange={e=>changeRoundRule(bracket.id,round,{win_by_two:e.target.checked,point_cap:e.target.checked?rule.point_cap:null})}/> Win by 2</label>
              </div>
              {rule.best_of>1 && <div className="round-scoring-fields round-scoring-decider">
                <label>Deciding set to<input type="number" min="1" max="100" value={rule.decider_target_points}
                  onChange={e=>changeRoundRule(bracket.id,round,{decider_target_points:Number(e.target.value)})}/></label>
                <label>Deciding cap<input type="number" min="1" max="999" placeholder="No cap" value={rule.decider_point_cap??''}
                  onChange={e=>changeRoundRule(bracket.id,round,{decider_point_cap:e.target.value===''?null:Number(e.target.value)})}/></label>
                <label className="compact-checkbox"><input type="checkbox" checked={rule.decider_win_by_two}
                  onChange={e=>changeRoundRule(bracket.id,round,{decider_win_by_two:e.target.checked,decider_point_cap:e.target.checked?rule.decider_point_cap:null})}/> Decider win by 2</label>
              </div>}
              {roundRuleError(rule) && <p className="form-error">{roundRuleError(rule)}</p>}
            </div>;
          })}
        </div>}
        {!!preview.length && <EliminationBracket
          label={`${bracket.name} ${bracket.format==='double'?'upper bracket':'bracket'} preview`}
          rounds={Array.from(new Set(preview.map(match => match.round))).map(round => ({
            number: round,
            cards: preview.filter(match => match.round === round).map(match => ({
              id: `${match.round}-${match.index}`,
              content: <>
                <div className="bracket-team">
                  <span title={teamName(match.teamA)}>{match.round === 1
                    ? `${match.seedA && match.seedA <= ids.length ? `#${match.seedA} · ` : ''}${match.teamA ? teamName(match.teamA) : 'BYE'}`
                    : 'Winner of previous match'}</span>
                </div>
                <div className="bracket-team">
                  <span title={teamName(match.teamB)}>{match.round === 1
                    ? `${match.seedB && match.seedB <= ids.length ? `#${match.seedB} · ` : ''}${match.teamB ? teamName(match.teamB) : 'BYE'}`
                    : 'Winner of previous match'}</span>
                </div>
                <small className="bracket-match-status">{match.round === 1 && (!match.teamA || !match.teamB)
                  ? 'Automatic advance' : 'Awaiting result'}</small>
              </>,
              state: match.round === 1 && (!match.teamA || !match.teamB) ? 'bye' as const : 'scheduled' as const,
            })),
          }))}/>}
        {bracket.format==='double' && <p className="review-format-note">Double elimination supports 2–64 teams, including seeded byes. Each team is eliminated after its second loss. A second grand final may be required if enabled. This preview shows the winners' bracket; the losers' bracket is built on finalization.</p>}
      </div>;
    })}

    {!running && isOwner && <div className="white-card playoff-approval">
      <h2>Approve pool results</h2>
      <p className="review-format-note">Check all scores, qualified teams, and final standings first. Pool results will be locked after finalization. Public visitors cannot generate brackets.</p>
      {assignmentError && <p className="form-error" role="alert">{assignmentError}</p>}
      {scoringError && <p className="form-error" role="alert">Playoff scoring: {scoringError}</p>}
      {!allComplete && <p className="form-error">{bundle.matches.length - complete} pool matches still need a result.</p>}
      {demoMode && <p className="review-format-note">Live bracket creation requires Supabase. Local demo can preview the seed assignments.</p>}
      <label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
        <span>I have reviewed every pool result and approve these playoff seeds.</span></label>
      {saveError && <p className="form-error" role="alert">{saveError}</p>}
      <button className="button button-primary" type="button" disabled={!canFinalize} onClick={finalize}>
        <ShieldCheck size={17}/> {brackets.length ? 'Finalize pool play & generate brackets' : 'Approve final standings'}
      </button>
    </div>}

    {running && brackets.map(bracket => {
      const matches = (bundle.playoffMatches ?? []).filter(m=>m.bracket_id===bracket.id);
      const maxRound = Math.max(0,...matches.map(m=>m.round_number));
      const championMatch = matches.find(m=>m.round_number===maxRound);
      const championScores = (bundle.playoffScores??[]).filter(s=>s.match_id===championMatch?.id);
      const championWinsA=championScores.filter(s=>s.score_a>s.score_b).length;
      const championWinsB=championScores.filter(s=>s.score_b>s.score_a).length;
      const champion = bracket.format==='double'
        ? (bracket.champion_team_id ? teamName(bracket.champion_team_id) : null)
        : championMatch && championMatch.status==='completed' && championScores.length
          ? teamName(championWinsA>championWinsB?championMatch.team_a_id:championMatch.team_b_id)
          : null;
      return <div className="white-card playoff-review-card" key={bracket.id}>
        <div className="card-heading"><div><h2>{bracket.name} bracket</h2>
          <p className="section-desc">{bracket.format === 'single' ? 'Single elimination' : 'Double elimination'}</p></div>
          <span className="subtle-tag">{champion ? `Champion: ${champion}` : bracket.status ?? 'Active'}</span></div>
        {bracket.format==='double' ? <DoubleEliminationMatches
          bracketName={bracket.name} matches={matches} bundle={bundle} teamName={teamName}
          busy={busy} isOwner={isOwner} onEnter={setActiveMatch}/> : <EliminationBracket
          label={`${bracket.name} active playoff bracket`}
          rounds={Array.from(new Set(matches.map(match => match.round_number))).map(round => ({
            number: round,
            cards: matches.filter(match => match.round_number === round).map(match => {
              const allScores = (bundle.playoffScores ?? []).filter(result => result.match_id === match.id);
              const winsA=allScores.filter(score=>score.score_a>score.score_b).length;
              const winsB=allScores.filter(score=>score.score_b>score.score_a).length;
              const rule=effectiveRoundRule(bundle,bracket.id,round);
              const ready = match.status === 'scheduled' && !!match.team_a_id && !!match.team_b_id
                && t.status === 'playoffs';
              const winningTeamA = match.status==='completed' && winsA>winsB;
              const winningTeamB = match.status==='completed' && winsB>winsA;
              return {
                id: match.id,
                state: match.status === 'completed' ? 'completed' as const
                  : match.status === 'bye' ? 'bye' as const : ready ? 'ready' as const : 'scheduled' as const,
                content: <>
                  <div className={`bracket-team ${winningTeamA ? 'bracket-team--winner' : ''}`}>
                    <span title={teamName(match.team_a_id)}>{teamName(match.team_a_id)}</span>
                    <strong>{allScores.length ? winsA : ''}</strong>
                  </div>
                  <div className={`bracket-team ${winningTeamB ? 'bracket-team--winner' : ''}`}>
                    <span title={teamName(match.team_b_id)}>{match.status === 'bye' && !match.team_b_id
                      ? 'BYE' : teamName(match.team_b_id)}</span>
                    <strong>{allScores.length ? winsB : ''}</strong>
                  </div>
                  <small className="bracket-match-status">{match.status === 'bye'
                    ? 'Automatic advance' : match.status === 'completed'
                      ? `${rule.best_of===1?'Single set':`Best of ${rule.best_of}`} · ${allScores.map(s=>`${s.score_a}–${s.score_b}`).join(' / ')}`
                      : ready ? `${rule.best_of===1?'Single set':`Best of ${rule.best_of}`} · Ready for score`
                      : 'Awaiting previous winners'}</small>
                  {(ready || (isOwner && bracket.format==='single' && match.status === 'completed')) &&
                    <button className="score-action" type="button" disabled={busy}
                      onClick={() => setActiveMatch(match)}>
                      {match.status === 'completed' ? 'Edit score' : 'Enter score'} <ChevronRight size={14}/>
                    </button>}
                </>,
              };
            }),
          }))}/>}

      </div>;
    })}
    {activeMatch && <PlayoffScoreModal match={activeMatch} bundle={bundle} teamName={teamName}
      busy={busy} onClose={()=>setActiveMatch(null)}
      onSave={async pairs=>{
        await onPlayoffScore(activeMatch,pairs.map(([score_a,score_b],i)=>({
          match_id:activeMatch.id,set_number:i+1,score_a,score_b,
        })));
        setActiveMatch(null);
      }}/>}
  </div>;
}

/** No player account is required to enter a completed playoff match series. */
function PlayoffScoreModal({ match, bundle, teamName, busy, onClose, onSave }: {
  match: PlayoffMatch; bundle: TournamentBundle; teamName:(id:string|null)=>string;
  busy:boolean; onClose:()=>void; onSave:(pairs:Array<[number,number]>)=>Promise<void>;
}) {
  const rule=effectiveRoundRule(bundle,match.bracket_id,match.round_number);
  const previous=scorePairs((bundle.playoffScores??[]).filter(s=>s.match_id===match.id));
  const [fields,setFields]=useState<Array<[string,string]>>(()=>
    Array.from({length:rule.best_of},(_,i):[string,string]=> previous[i]
      ? [String(previous[i][0]),String(previous[i][1])] : ['','']),
  );
  const [error,setError]=useState('');
  const needed=Math.floor(rule.best_of/2)+1;
  const save=async (event:React.FormEvent)=>{
    event.preventDefault();setError('');
    const pairs:Array<[number,number]>=[];
    let gap=false;
    for (const [a,b] of fields) {
      if (!a.trim() && !b.trim()) {gap=true;continue;}
      if (!a.trim() || !b.trim() || gap) {setError('Enter both scores consecutively, without skipped sets.');return;}
      pairs.push([Number(a),Number(b)]);
    }
    const {error:validation}=evaluateSeries(pairs,rule);
    if (validation) {setError(validation);return;}
    try {await onSave(pairs);}catch(err){setError(err instanceof Error?err.message:String(err));}
  };
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="playoff-score-title">
      <button className="modal-x" type="button" onClick={onClose} aria-label="Close"><X size={19}/></button>
      <div className="modal-kicker"><Trophy size={17}/> PLAYOFF · ROUND {match.round_number}</div>
      <h2 id="playoff-score-title">{previous.length?'Correct playoff result':'Enter playoff result'}</h2>
      <p className="modal-desc">{rule.best_of===1?'Single set':`Best of ${rule.best_of}`} — first to {needed} set win{needed===1?'':'s'}.
        Regular sets to {rule.target_points}{rule.win_by_two?', win by 2':''}{rule.point_cap!=null?`, cap ${rule.point_cap}`:''}.
        {rule.best_of>1&&` Deciding set to ${rule.decider_target_points}${rule.decider_win_by_two?', win by 2':''}${rule.decider_point_cap!=null?`, cap ${rule.decider_point_cap}`:''}.`}
        {previous.length?' Only organizers may correct an existing result.':' Submit all played sets at once; unused sets remain blank.'}</p>
      <form onSubmit={save}>
        <div className="score-header"><strong>{teamName(match.team_a_id)}</strong><span>VS</span><strong>{teamName(match.team_b_id)}</strong></div>
        {fields.map(([a,b],i)=><div className="score-entry-row" key={i}>
          <span>Set {i+1}{i===rule.best_of-1&&rule.best_of>1?' (decider)':''}</span>
          <input aria-label={`Set ${i+1} first team score`} type="number" min={0} max={999} value={a}
            onChange={e=>setFields(old=>old.map((v,j)=>j===i?([e.target.value,v[1]] as [string,string]):v))}/>
          <span>—</span>
          <input aria-label={`Set ${i+1} second team score`} type="number" min={0} max={999} value={b}
            onChange={e=>setFields(old=>old.map((v,j)=>j===i?([v[0],e.target.value] as [string,string]):v))}/>
        </div>)}
        {error&&<div className="form-error" role="alert">{error}</div>}
        <div className="modal-footer"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={busy}><Save size={16}/> {previous.length?'Save correction':'Submit match result'}</button></div>
      </form>
    </div>
  </div>;
}

function PoolPanel({ pool, bundle, isOwner, teamName, onEdit }: {
  pool: Pool; bundle: TournamentBundle; isOwner: boolean; teamName: (id:string)=>string; onEdit: (match:Match)=>void;
}) {
  const standings = standingsForPool(bundle,pool.id);
  const matches = bundle.matches.filter(m => m.pool_id === pool.id);
  const status = bundle.tournament.status;
  const ownerMayEdit = isOwner && ['published', 'pool_play'].includes(status);
  // Players need no accounts. Once pool play starts they may submit the first
  // score for a scheduled match, but cannot overwrite an existing result.
  const publicMaySubmit = !isOwner && !demoMode && status === 'pool_play';
  const permitted = ownerMayEdit || publicMaySubmit;
  return <div className="pool-columns"><div className="white-card"><div className="card-heading"><h2>{pool.label} standings</h2><span className="subtle-tag">Live results</span></div><div className="table-scroll"><table className="standings-table"><thead><tr><th>#</th><th>TEAM</th><th>SW</th><th>SL</th><th>WIN %</th><th>PF</th><th>PA</th></tr></thead><tbody>{standings.map(s=><tr key={s.team.id}><td><span className={`rank-number ${s.rank<=2?'top-rank':''}`}>{s.rank}</span></td><td className="team-cell">{s.team.name}</td><td>{s.wins}</td><td>{s.losses}</td><td className="pct-cell">{(s.winPct*100).toFixed(1)}%</td><td>{s.pointsFor}</td><td>{s.pointsAgainst}</td></tr>)}</tbody></table></div>
    <p className="table-caption">SW = sets won · SL = sets lost · PF/PA = points for/against. Ties: head-to-head for exactly two teams, then point ratio and normalized differential.</p></div>
    <div className="white-card"><div className="card-heading"><div><h2>Match schedule</h2><p className="section-desc">{matches.filter(m=>m.status==='completed').length} of {matches.length} complete</p></div><span className="subtle-tag">{bundle.tournament.pool_sets} set{bundle.tournament.pool_sets>1?'s':''} each</span></div>
    <p className="table-caption">Pool rules: first to {scoringForPool(bundle,pool.id).targetPoints}{scoringForPool(bundle,pool.id).winByTwo?', win by 2':''}{scoringForPool(bundle,pool.id).pointCap != null ? `, cap ${scoringForPool(bundle,pool.id).pointCap}` : ''}.</p>
      <div className="match-list">{matches.map(m=>{const scores = bundle.scores.filter(s=>s.match_id===m.id).sort((a,b)=>a.set_number-b.set_number);return <div className="match-row" key={m.id}><div className="match-left"><span className="match-seq">R{m.round_number}</span><div className="match-teams"><strong>{teamName(m.team_a_id)} <span>vs</span> {teamName(m.team_b_id)}</strong><small>{m.status==='completed'?'Final score':'Not played'}</small></div></div>
      <div className="match-right">{scores.length?<div className="small-scores">{scores.map(s=><span key={s.set_number}>{s.score_a}–{s.score_b}</span>)}</div>:<span className="awaiting">—</span>}
        {permitted && (ownerMayEdit || m.status === 'scheduled') && <button className="score-action" onClick={()=>onEdit(m)}>{m.status==='completed'?'Edit score':isOwner?'Enter score':'Submit score'}<ChevronRight size={15}/></button>}
      </div></div>})}</div>
      {!permitted && isOwner && <p className="table-caption">Publish the tournament and start pool play to enable score entry.</p>}
      {!isOwner && status === 'pool_play' && <p className="table-caption">Players can submit scores for unfinished matches without signing in. Once submitted, only the organizer can correct a result. Results refresh approximately every 15 seconds.</p>}
      {!isOwner && status === 'published' && <p className="table-caption">The organizer has not started pool play yet. Scores will open for everyone when play begins.</p>}
    </div></div>;
}
function ScoreModal({ match, bundle, teamName, busy, onClose, onSave }: {
  match: Match; bundle: TournamentBundle; teamName:(id:string)=>string;
  busy:boolean; onClose:()=>void; onSave:(pairs:Array<[number,number]>)=>Promise<void>;
}) {
  const existing = bundle.scores.filter(s=>s.match_id===match.id).sort((a,b)=>a.set_number-b.set_number);
  const rules = scoringForPool(bundle, match.pool_id);
  const [pairs,setPairs] = useState<Array<[string,string]>>(Array.from({length:bundle.tournament.pool_sets},(_,i): [string,string]=>[String(existing[i]?.score_a??''),String(existing[i]?.score_b??'')]));
  const [error,setError]=useState('');
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    const parsed = pairs.map(([a,b])=>[a===''?NaN:Number(a),b===''?NaN:Number(b)] as [number,number]);
    const validation = scoreError(parsed,bundle.tournament.pool_sets,rules.targetPoints,rules.winByTwo,rules.pointCap);
    if(validation){setError(validation);return;}
    try {await onSave(parsed);}catch(e){setError(e instanceof Error?e.message:String(e));}
  };
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="score-dialog-title"><button className="modal-x" onClick={onClose} aria-label="Close"><X size={19}/></button>
    <div className="modal-kicker"><ClipboardList size={18}/> POOL PLAY · ROUND {match.round_number}</div><h2 id="score-dialog-title">Enter match score</h2><p className="modal-desc">Each set counts independently toward the standings. If there are two sets, a 1–1 split is allowed.</p>
    <form onSubmit={save}><div className="score-header"><strong>{teamName(match.team_a_id)}</strong><span>VS</span><strong>{teamName(match.team_b_id)}</strong></div>
      {pairs.map((row,i)=><div className="score-entry-row" key={i}><span>Set {i+1}</span><input aria-label={`Set ${i+1} ${teamName(match.team_a_id)} score`} required type="number" min={0} max={999} value={row[0]} onChange={e=>setPairs(old=>old.map((v,j)=>j===i?([e.target.value,v[1]] as [string,string]):v))}/><span>—</span><input aria-label={`Set ${i+1} ${teamName(match.team_b_id)} score`} required type="number" min={0} max={999} value={row[1]} onChange={e=>setPairs(old=>old.map((v,j)=>j===i?([v[0],e.target.value] as [string,string]):v))}/></div>)}
      <div className="score-help">First to {rules.targetPoints}{rules.winByTwo?', win by 2':''}{rules.pointCap != null ? `, capped at ${rules.pointCap}` : ''}. Scores update all pool standings automatically. {match.status === 'scheduled' ? 'Once submitted publicly, only the organizer can correct this result.' : ''}</div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-footer"><button className="button button-outline" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}><Save size={16}/> {busy?'Saving…':'Save result'}</button></div>
    </form></div></div>;
}


/** Alpha login uses Supabase Auth directly. Password never enters the database tables. */
function AlphaLogin({onClose, onSubmit}: {
  onClose: () => void;
  onSubmit: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try { await onSubmit(email.trim(), password); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onMouseDown={e => {
    if(e.currentTarget === e.target) onClose();
  }}>
    <div className="modal alpha-login" role="dialog" aria-modal="true" aria-labelledby="alpha-login-heading">
      <button className="modal-x" onClick={onClose} aria-label="Close sign in"><X size={19}/></button>
      <div className="modal-kicker"><LockKeyhole size={18}/> PRIVATE ALPHA ACCESS</div>
      <h2 id="alpha-login-heading">Organizer sign in</h2>
      <p className="modal-desc">Use the email address and password of your approved organizer account.</p>
      <form onSubmit={login}>
        <div className="field"><label htmlFor="alpha-email">Email address</label>
          <input id="alpha-email" type="email" required autoComplete="username" value={email}
            onChange={e=>setEmail(e.target.value)}/></div>
        <div className="field"><label htmlFor="alpha-password">Password</label>
          <input id="alpha-password" type="password" required autoComplete="current-password" value={password}
            onChange={e=>setPassword(e.target.value)}/></div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-footer"><button className="button button-outline" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" disabled={busy} type="submit">{busy?'Signing in…':'Sign in'}</button></div>
      </form>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
