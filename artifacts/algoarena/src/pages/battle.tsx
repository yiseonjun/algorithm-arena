import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronDown, CircleAlert, Clock3, Code2, Copy, Heart, LoaderCircle, Radio, RotateCcw, Send, Swords, Wifi, WifiOff, Zap } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { getGetBattleQueryKey, getGetChallengeQueryKey, useGetBattle, useGetChallenge, useSubmitCode } from '@workspace/api-client-react';
import type { Battle, BattleSession, SubmissionResult } from '@workspace/api-client-react';

type ArenaEvent = { type?: string; event?: string; battle?: Battle; session?: BattleSession; data?: unknown; playerId?: string; damageDealt?: number; playerName?: string; mode?: string };

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`;
}

const verdictLabels: Record<string, string> = {
  AC: '정답',
  WA: '오답',
  TLE: '시간 초과',
  MLE: '메모리 초과',
  RE: '실행 오류',
  CE: '코드 오류',
};
const difficultyLabels: Record<string, string> = {
  BRONZE: '브론즈',
  SILVER: '실버',
  GOLD: '골드',
};
const getVerdictLabel = (verdict: string) => verdictLabels[verdict] ?? verdict;
const getDifficultyLabel = (difficulty?: string) => difficultyLabels[difficulty ?? ''] ?? difficulty ?? '—';
const getModeLabel = (mode?: string) => mode === 'RUN' ? '실행' : mode === 'SUBMIT' ? '제출' : mode ?? '제출';

function playAttackSound() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(190, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(72, context.currentTime + 0.16);
    gain.gain.setValueAtTime(0.045, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.17);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
    oscillator.onended = () => { void context.close(); };
  } catch {
    // Audio is optional when browser playback is unavailable.
  }
}

export default function BattlePage() {
  const { roomId = '' } = useParams<{ roomId: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const playerId = typeof window !== 'undefined' ? sessionStorage.getItem('algoarena-player-id') ?? '' : '';
  const battleQuery = useGetBattle(roomId, playerId, { query: { enabled: !!roomId && !!playerId, queryKey: getGetBattleQueryKey(roomId, playerId), refetchInterval: 15000 } });
  const [liveBattle, setLiveBattle] = useState<Battle | null>(null);
  const battle = liveBattle ?? battleQuery.data?.battle;
  const me = battle?.players.find((player) => player.id === playerId);
  const rival = battle?.players.find((player) => player.id !== playerId);
  const challengeIds = battle?.challengeIds ?? [];
  const problemCount = challengeIds.length;
  const problemIndex = me?.currentChallengeIndex ?? 0;
  const allProblemsSolved = problemCount > 0 && problemIndex >= problemCount;
  const challengeId = challengeIds[Math.min(problemIndex, problemCount - 1)] ?? '';
  const challengeQuery = useGetChallenge(challengeId, { query: { enabled: !!challengeId, queryKey: getGetChallengeQueryKey(challengeId) } });
  const challenge = challengeQuery.data;
  const [code, setCode] = useState('');
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [split, setSplit] = useState(43);
  const [socketReady, setSocketReady] = useState(false);
  const [socketError, setSocketError] = useState(false);
  const [attack, setAttack] = useState<{ id: number; damage: number } | null>(null);
  const [pendingRivalSubmission, setPendingRivalSubmission] = useState<{ playerId: string; mode?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [requestError, setRequestError] = useState('');
  const dragRef = useRef(false);
  const submitCode = useSubmitCode();

  useEffect(() => {
    if (battleQuery.data?.battle) setLiveBattle(battleQuery.data.battle);
  }, [battleQuery.data]);

  useEffect(() => {
    if (challenge?.starterCode && roomId && playerId) {
      const saved = localStorage.getItem(`algoarena-code:${roomId}:${playerId}:${challenge.id}`);
      setCode(saved ?? challenge.starterCode);
    }
  }, [challenge?.id, roomId, playerId]);

  useEffect(() => {
    if (code && challenge?.id && roomId && playerId) {
      localStorage.setItem(`algoarena-code:${roomId}:${playerId}:${challenge.id}`, code);
    }
  }, [code, challenge?.id, roomId, playerId]);

  useEffect(() => {
    if (!roomId || !playerId || typeof window === 'undefined') return;
    let active = true;
    let retryCount = 0;
    let retryTimer: number | undefined;
    let socket: WebSocket | undefined;
    const connect = () => {
      if (!active) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      try {
        socket = new WebSocket(`${protocol}//${window.location.host}/ws/battle/${encodeURIComponent(roomId)}/${encodeURIComponent(playerId)}`);
      } catch {
        setSocketError(true);
        retryTimer = window.setTimeout(connect, 2500);
        return;
      }
      socket.onopen = () => {
        retryCount = 0;
        setSocketReady(true);
        setSocketError(false);
        void queryClient.invalidateQueries({ queryKey: getGetBattleQueryKey(roomId, playerId) });
      };
      socket.onclose = () => {
        setSocketReady(false);
        setSocketError(true);
        if (active) {
          const delay = Math.min(5000, 500 * 2 ** Math.min(retryCount, 3));
          retryCount += 1;
          retryTimer = window.setTimeout(connect, delay);
        }
      };
      socket.onerror = () => { setSocketError(true); };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as ArenaEvent;
          const kind = (event.type ?? event.event ?? '').toUpperCase();
          const nested = event.data && typeof event.data === 'object' ? event.data as ArenaEvent : undefined;
          const incoming = event.battle ?? event.session?.battle ?? nested?.battle ?? nested?.session?.battle;
          if (incoming) setLiveBattle(incoming);
          if (kind === 'CODE_SUBMITTED' && event.playerId !== playerId) {
            setPendingRivalSubmission({ playerId: event.playerId ?? '', mode: event.mode });
          }
          if (kind === 'SUBMISSION_RESULT' && event.playerId !== playerId) {
            setPendingRivalSubmission(null);
          }
          if (kind === 'ATTACK_EVENT') {
            const data = nested ?? event;
            setAttack({ id: Date.now(), damage: data.damageDealt ?? 1 });
            window.setTimeout(() => setAttack(null), 800);
            playAttackSound();
          }
          if (kind === 'PLAYER_JOIN' || kind === 'GAME_OVER' || kind === 'STATE_SYNC') {
            void queryClient.invalidateQueries({ queryKey: getGetBattleQueryKey(roomId, playerId) });
          }
        } catch {
          setSocketError(true);
        }
      };
    };
    connect();
    return () => {
      active = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [roomId, playerId, queryClient]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragRef.current) return;
      const next = (event.clientX / window.innerWidth) * 100;
      setSplit(Math.max(30, Math.min(68, next)));
    };
    const up = () => { dragRef.current = false; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  const finished = battle?.status === 'FINISHED';
  const secondsRemaining = battle?.secondsRemaining ?? 0;
  const winner = battle?.players.find((player) => player.id === battle.winnerPlayerId);
  const sendCode = (mode: 'RUN' | 'SUBMIT') => {
    if (!playerId || !roomId || !challengeId || allProblemsSolved || submitCode.isPending) return;
    setResult(null);
    setRequestError('');
    submitCode.mutate({ roomId, data: { playerId, challengeId, code, mode } }, {
      onSuccess: (response) => {
        setResult(response);
        setLiveBattle(response.battle);
        queryClient.setQueryData(getGetBattleQueryKey(roomId, playerId), (old: BattleSession | undefined) => old ? { ...old, battle: response.battle } : old);
      },
      onError: () => setRequestError('제출을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'),
    });
  };

  const copyRoom = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  if (!playerId) return <main className="noise grid min-h-[100dvh] place-items-center bg-[#0B0E17] px-5"><div className="max-w-md rounded-2xl border border-white/10 bg-[#111622] p-7 text-center"><CircleAlert className="mx-auto text-amber-300" /><h1 className="mt-4 text-xl font-semibold">참가자 정보를 찾을 수 없습니다</h1><p className="mt-2 text-sm text-slate-400">대기실로 돌아가 방을 새로 만들거나 참가해 주세요.</p><button data-testid="button-return-lobby" onClick={() => setLocation('/')} className="mt-5 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-semibold">대기실로 돌아가기</button></div></main>;

  if (battleQuery.isLoading) return <BattleSkeleton />;
  if (battleQuery.isError || !battleQuery.data) return <main className="noise grid min-h-[100dvh] place-items-center bg-[#0B0E17] px-5"><div className="max-w-md rounded-2xl border border-red-400/20 bg-[#111622] p-7 text-center"><CircleAlert className="mx-auto text-red-300" /><h1 className="mt-4 text-xl font-semibold">대결 정보를 불러오지 못했습니다</h1><p className="mt-2 text-sm text-slate-400">방이 종료되었거나 연결이 끊겼을 수 있습니다.</p><button data-testid="button-retry-match" onClick={() => battleQuery.refetch()} className="mt-5 rounded-lg border border-white/10 px-4 py-2.5 text-sm hover:bg-white/5">다시 연결</button></div></main>;

  return (
    <main className={`noise min-h-[100dvh] bg-[#0B0E17] pb-14 md:pb-0 ${attack ? 'attack-shake' : ''}`}>
      <header className="flex h-[62px] items-center justify-between border-b border-white/[.08] bg-[#0d111c] px-4 md:px-6">
        <div className="flex items-center gap-3">
          <button data-testid="button-back-lobby" aria-label="대기실로 돌아가기" onClick={() => setLocation('/')} className="grid h-8 w-8 place-items-center rounded-lg border border-white/[.08] text-slate-400 transition hover:bg-white/[.05] hover:text-white"><ArrowLeft size={15} /></button>
          <div className="grid h-8 w-8 place-items-center rounded-lg border border-blue-400/25 bg-blue-500/10 text-blue-300"><Swords size={16} /></div>
          <div><div className="text-[12px] font-bold tracking-[.14em]">ALGO<span className="text-blue-400">ARENA</span></div><div className="mono text-[8px] tracking-[.08em] text-slate-600">실시간 대결</div></div>
          <div className="mx-2 hidden h-7 w-px bg-white/[.08] sm:block" />
          <div className="hidden sm:block"><div className="text-xs font-medium text-slate-200">{challenge?.title ?? '문제 불러오는 중…'}</div><div className="mono text-[8px] tracking-[.04em] text-slate-600">{getDifficultyLabel(challenge?.difficulty)} · {challenge?.points ?? '—'}점</div></div>
        </div>
        <div className="flex items-center gap-3">
          <button data-testid="button-copy-room" aria-label="방 코드 복사" onClick={copyRoom} className="mono flex items-center gap-2 rounded-md border border-white/[.09] px-2.5 py-1.5 text-[9px] tracking-[.1em] text-slate-400 hover:border-white/20 hover:text-slate-200"><span>방 {roomId}</span>{copied ? <Check size={12} className="text-emerald-300" /> : <Copy size={12} />}</button>
          <div data-testid="status-socket" className={`mono hidden items-center gap-1.5 text-[9px] tracking-[.06em] sm:flex ${socketReady ? 'text-emerald-300' : socketError ? 'text-amber-300' : 'text-slate-500'}`}>{socketReady ? <Wifi size={12} /> : <WifiOff size={12} />}{socketReady ? '실시간 연결' : socketError ? '재연결 중' : '연결 중'}</div>
          <div data-testid="text-match-timer" className={`mono flex min-w-[83px] items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm ${secondsRemaining <= 30 ? 'border-red-400/30 bg-red-500/10 text-red-300' : 'border-white/[.09] bg-white/[.025] text-slate-100'}`}><Clock3 size={13} className={secondsRemaining <= 30 ? 'text-red-300' : 'text-blue-300'} />{formatTime(secondsRemaining)}</div>
        </div>
      </header>

      <DuelStatus players={battle?.players ?? []} playerId={playerId} />
      <section className="battle-layout grid h-[calc(100dvh-132px)] min-h-[570px] grid-cols-1 md:overflow-hidden" style={{ gridTemplateColumns: `minmax(310px, ${split}fr) 10px minmax(360px, ${100 - split}fr)` }}>
        <ProblemPanel challenge={challenge} challengeIds={challengeIds} problemIndex={problemIndex} problemCount={problemCount} allProblemsSolved={allProblemsSolved} submissions={battle?.submissions ?? []} pendingSubmission={pendingRivalSubmission} loading={challengeQuery.isLoading && !challenge} />
        <div role="separator" aria-label="문제와 편집기 영역 크기 조절" aria-orientation="vertical" onPointerDown={(event) => { event.preventDefault(); dragRef.current = true; }} className="group relative hidden cursor-col-resize items-center justify-center bg-[#0b0e17] md:flex"><span className="h-14 w-[3px] rounded-full bg-slate-700 transition group-hover:bg-blue-400 group-active:bg-blue-300" /></div>
        <div className="flex min-h-[650px] flex-col border-l border-white/[.07] bg-[#0e121c]">
          <div className="relative flex items-center justify-between border-b border-white/[.07] px-4 py-3">
            <div className="flex items-center gap-3"><div className="mono flex items-center gap-2 text-[10px] text-slate-300"><Code2 size={14} className="text-blue-300" />solution.py</div><span className="rounded bg-blue-500/[.1] px-1.5 py-0.5 text-[8px] text-blue-300">PYTHON 3</span></div>
            <div className="flex items-center gap-2"><span className="mono hidden text-[9px] text-slate-600 sm:block">기기에 자동 저장됨</span><ChevronDown size={13} className="text-slate-600" /></div>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <PythonCodeEditor value={code} onChange={setCode} />
            {attack && <div key={attack.id} className="heart-hit pointer-events-none absolute right-9 top-10 z-10 flex items-center gap-1.5 rounded-full border border-red-300/20 bg-red-500/15 px-3 py-1.5 text-sm font-bold text-red-300"><Heart size={15} fill="currentColor" />-{attack.damage}</div>}
          </div>
          <ResultPanel result={result} pending={submitCode.isPending} error={requestError} verdictLabel={getVerdictLabel} />
          <div className="flex items-center justify-between border-t border-white/[.07] px-4 py-3">
            <div className="mono flex items-center gap-2 text-[9px] text-slate-600"><span className="text-slate-500">PYTHON 3</span><span>·</span><span>실행 준비 완료</span></div>
            <div className="flex gap-2">
              <button data-testid="button-run-code" disabled={submitCode.isPending || battle?.status !== 'ACTIVE' || allProblemsSolved} onClick={() => sendCode('RUN')} className="flex h-9 items-center gap-2 rounded-lg border border-white/[.11] px-3 text-xs font-semibold text-slate-300 transition hover:bg-white/[.05] disabled:opacity-40"><Zap size={13} />실행</button>
              <button data-testid="button-submit-code" disabled={submitCode.isPending || battle?.status !== 'ACTIVE' || allProblemsSolved} onClick={() => sendCode('SUBMIT')} className="flex h-9 items-center gap-2 rounded-lg bg-blue-500 px-4 text-xs font-bold text-white transition hover:bg-blue-400 disabled:opacity-40">{submitCode.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={13} />}{battle?.status === 'WAITING' ? '상대 참가 대기 중' : finished ? '대결 종료' : allProblemsSolved ? '3문제 완료' : '제출'}</button>
            </div>
          </div>
        </div>
      </section>

      <div className="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-between border-t border-white/[.08] bg-[#0d111c]/95 px-4 py-2 backdrop-blur md:hidden">
        <PlayerStrip player={me} label="나" tone="blue" />
        <div className="mono text-xs text-slate-300">{formatTime(battle?.secondsRemaining ?? 0)}</div>
        <PlayerStrip player={rival} label="상대" tone="purple" />
      </div>
      {finished && <ResultOverlay winner={winner} me={me} elapsedSeconds={battle?.elapsedSeconds ?? 0} onLobby={() => setLocation('/')} onReplay={() => setLocation('/')} />}
    </main>
  );
}

function ProblemPanel({ challenge, challengeIds, problemIndex, problemCount, allProblemsSolved, submissions, pendingSubmission, loading }: { challenge?: BattleSession['challenge']; challengeIds: string[]; problemIndex: number; problemCount: number; allProblemsSolved: boolean; submissions: Battle['submissions']; pendingSubmission: { playerId: string; mode?: string } | null; loading: boolean }) {
  const [tab, setTab] = useState<'problem' | 'examples' | 'submissions'>('problem');
  return <aside className="flex min-h-[360px] flex-col overflow-y-auto border-r border-white/[.07] bg-[#101520] pb-16 md:pb-5">
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/[.07] px-5"><div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-purple-400" /><span className="mono text-[9px] tracking-[.08em] text-slate-400">문제 안내</span></div><div className="mono text-[9px] text-slate-600">대결 규칙 / 01</div></div>
    <div className="flex items-center gap-2 px-5 pt-4" aria-label="문제 진행 상황">
      <div className="flex flex-1 gap-1">{challengeIds.map((id, index) => <span key={id} className={`h-1 flex-1 rounded-full ${index < problemIndex || allProblemsSolved ? 'bg-blue-400' : index === problemIndex ? 'bg-blue-300/80' : 'bg-white/10'}`} />)}</div>
      <span className="mono shrink-0 text-[9px] tracking-[.04em] text-slate-400">{allProblemsSolved ? `${problemCount} / ${problemCount} 완료` : `문제 ${Math.min(problemIndex + 1, problemCount)} / ${problemCount}`}</span>
    </div>
    {loading ? <div className="space-y-4 p-6"><div className="h-5 w-2/3 animate-pulse rounded bg-white/[.06]" /><div className="h-20 animate-pulse rounded bg-white/[.04]" /><div className="h-32 animate-pulse rounded bg-white/[.04]" /></div> : !challenge ? <div className="p-6 text-sm text-slate-500">문제 정보를 불러올 수 없습니다.</div> :
      <div className="p-5 md:p-6">
        <div className="mono text-[9px] tracking-[.05em] text-blue-300">알고리즘 · Python</div>
        <h1 data-testid="text-challenge-title" className="mt-2 text-[26px] font-semibold leading-tight tracking-[-.04em] text-slate-100">{challenge.title}</h1>
        <p className="mt-3 text-[13px] leading-6 text-slate-400">{challenge.summary}</p>
        {allProblemsSolved && <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-500/[.06] px-3 py-2 text-[11px] leading-5 text-emerald-200">선택한 세 문제를 모두 풀었습니다. 상대의 결과를 기다리고 있습니다.</div>}
        <div className="mt-5 grid grid-cols-2 gap-2"><div className="rounded-lg border border-white/[.07] bg-white/[.02] p-3"><div className="mono text-[8px] tracking-[.04em] text-slate-600">난이도</div><div className="mt-1 text-xs font-semibold text-slate-200">{getDifficultyLabel(challenge.difficulty)}</div></div><div className="rounded-lg border border-white/[.07] bg-white/[.02] p-3"><div className="mono text-[8px] tracking-[.04em] text-slate-600">획득 점수</div><div className="mt-1 text-xs font-semibold text-blue-300">{challenge.points}점</div></div></div>
         <div className="mt-6 flex border-b border-white/[.08]"><button data-testid="tab-problem" onClick={() => setTab('problem')} className={`mono border-b-2 px-3 pb-2 text-[9px] tracking-[.04em] ${tab === 'problem' ? 'border-blue-400 text-blue-300' : 'border-transparent text-slate-600'}`}>문제</button><button data-testid="tab-examples" onClick={() => setTab('examples')} className={`mono border-b-2 px-3 pb-2 text-[9px] tracking-[.04em] ${tab === 'examples' ? 'border-blue-400 text-blue-300' : 'border-transparent text-slate-600'}`}>예시</button><button data-testid="tab-submissions" onClick={() => setTab('submissions')} className={`mono border-b-2 px-3 pb-2 text-[9px] tracking-[.04em] ${tab === 'submissions' ? 'border-blue-400 text-blue-300' : 'border-transparent text-slate-600'}`}>제출 기록 <span className="ml-1 text-slate-500">{submissions.length}</span></button></div>
         {tab === 'problem' ? <div className="space-y-5 pt-5">
           <section><h2 className="mono mb-2 text-[9px] tracking-[.04em] text-slate-500">문제 설명</h2><p className="whitespace-pre-line text-[12px] leading-[1.8] text-slate-300">{challenge.description}</p></section>
           <section><h2 className="mono mb-2 text-[9px] tracking-[.04em] text-slate-500">입력 형식</h2><p className="whitespace-pre-line text-[11px] leading-5 text-slate-400">{challenge.inputFormat}</p></section>
           <section><h2 className="mono mb-2 text-[9px] tracking-[.04em] text-slate-500">출력 형식</h2><p className="whitespace-pre-line text-[11px] leading-5 text-slate-400">{challenge.outputFormat}</p></section>
           <section><h2 className="mono mb-2 text-[9px] tracking-[.04em] text-slate-500">제한 조건</h2><ul className="space-y-1">{challenge.constraints.map((constraint, index) => <li key={index} className="mono text-[10px] leading-5 text-slate-400"><span className="mr-2 text-purple-400">/</span>{constraint}</li>)}</ul></section>
          </div> : tab === 'examples' ? <div className="space-y-3 pt-4">{challenge.examples.map((example, index) => <div key={index} className="rounded-lg border border-white/[.07] bg-[#0c111b] p-3.5"><div className="mono mb-3 text-[9px] tracking-[.04em] text-purple-300">예시 {String(index + 1).padStart(2, '0')}</div><div className="grid grid-cols-[48px_1fr] gap-y-2 text-[10px]"><span className="mono text-slate-600">입력</span><code className="mono whitespace-pre-wrap text-slate-300">{example.input}</code><span className="mono text-slate-600">출력</span><code className="mono whitespace-pre-wrap text-emerald-300">{example.output}</code></div>{example.explanation && <p className="mt-3 border-t border-white/[.06] pt-2 text-[10px] leading-5 text-slate-500">{example.explanation}</p>}</div>)}</div> : <div className="space-y-2 pt-4">
            {pendingSubmission && <div data-testid="status-opponent-submitting" className="flex items-center gap-2 rounded-lg border border-blue-400/20 bg-blue-500/[.06] px-3 py-2.5 text-[10px] text-blue-200"><LoaderCircle size={12} className="animate-spin" />상대가 코드를 제출했습니다 · {getModeLabel(pendingSubmission.mode)} 검토 중</div>}
            {submissions.length === 0 && !pendingSubmission ? <div className="rounded-lg border border-dashed border-white/[.08] px-4 py-6 text-center text-[10px] text-slate-600">아직 제출한 코드가 없습니다. 먼저 도전해 보세요.</div> : submissions.map((entry) => <div key={entry.id} data-testid={`row-submission-${entry.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-white/[.06] bg-[#0c111b] px-3 py-2.5">
              <div className="min-w-0"><div className="truncate text-[11px] font-medium text-slate-300">{entry.playerName}</div><div className="mono mt-1 text-[8px] tracking-[.04em] text-slate-600">문제 {Math.max(1, challengeIds.indexOf(entry.challengeId) + 1)} · {getModeLabel(entry.mode)} · {new Date(String(entry.createdAt)).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div></div>
              <span className={`mono shrink-0 rounded border px-2 py-1 text-[8px] tracking-[.04em] ${entry.verdict === 'AC' ? 'border-emerald-400/20 bg-emerald-500/[.06] text-emerald-300' : 'border-red-400/20 bg-red-500/[.06] text-red-300'}`}>{getVerdictLabel(entry.verdict)}</span>
           </div>)}
         </div>}
      </div>}
  </aside>;
}

function DuelStatus({ players, playerId }: { players: Battle['players']; playerId: string }) {
  const me = players.find((player) => player.id === playerId);
  const rival = players.find((player) => player.id !== playerId);
  return <section className="flex h-[70px] items-center justify-center gap-5 border-b border-white/[.07] bg-[#0d111b] px-4 md:gap-12">
      <DuelContender player={me} side="left" label="나" />
    <div className="flex items-center gap-2">
      <div className="h-px w-5 bg-gradient-to-r from-transparent to-slate-700 md:w-10" />
      <span className="mono text-[9px] font-medium tracking-[.08em] text-slate-600">대</span>
      <div className="h-px w-5 bg-gradient-to-l from-transparent to-slate-700 md:w-10" />
    </div>
      <DuelContender player={rival} side="right" label="상대" />
  </section>;
}

function DuelContender({ player, side, label }: { player?: Battle['players'][number]; side: 'left' | 'right'; label: string }) {
  const tone = side === 'left' ? 'text-blue-300' : 'text-purple-300';
  const alignment = side === 'left' ? 'items-start text-left' : 'items-end text-right';
  return <div className={`flex min-w-[112px] flex-col ${alignment}`}>
    <div className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${player?.connected ? 'bg-emerald-400' : player ? 'bg-amber-400' : 'bg-slate-700'}`} /><span className="mono max-w-[130px] truncate text-[9px] tracking-[.04em] text-slate-500">{label} / {player?.name ?? '상대 대기 중'}</span></div>
    <div className="mt-1 flex items-center gap-2"><div className="flex gap-[3px]">{Array.from({ length: 3 }, (_, index) => <Heart key={index} size={11} className={index < (player?.hearts ?? 0) ? 'fill-red-400 text-red-400' : 'text-slate-700'} />)}</div><span className={`mono text-[9px] ${tone}`}>{player?.points ?? 0}점</span><span className="mono text-[8px] text-slate-600">{Math.min(player?.currentChallengeIndex ?? 0, 3)}/3</span></div>
  </div>;
}

function PythonCodeEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const options = useMemo(() => ({
    minimap: { enabled: false },
    fontFamily: "'DM Mono', monospace",
    fontSize: 12,
    lineHeight: 22,
    lineNumbers: 'on' as const,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 4,
    insertSpaces: true,
    padding: { top: 18, bottom: 18 },
    renderLineHighlight: 'line',
    overviewRulerBorder: false,
    scrollbar: { verticalScrollbarSize: 7, horizontalScrollbarSize: 7 },
    suggest: { showWords: false },
  }), []);
  return <div className="min-h-[330px] flex-1 overflow-hidden">
    <Editor height="100%" language="python" theme="algoarena-dark" value={value} onChange={(next) => onChange(next ?? '')} options={options} onMount={(_editor, monaco) => {
      monaco.editor.defineTheme('algoarena-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'keyword', foreground: '9B8AFB' },
          { token: 'number', foreground: '82C7FF' },
          { token: 'string', foreground: 'A8D9B5' },
          { token: 'comment', foreground: '69758A', fontStyle: 'italic' },
          { token: 'identifier', foreground: 'DCE4F2' },
        ],
        colors: {
          'editor.background': '#0E121C',
          'editor.foreground': '#DCE4F2',
          'editorLineNumber.foreground': '#4C566B',
          'editorLineNumber.activeForeground': '#9AA8C0',
          'editorCursor.foreground': '#60A5FA',
          'editor.lineHighlightBackground': '#FFFFFF08',
          'editor.selectionBackground': '#3B82F64D',
          'editorIndentGuide.background': '#FFFFFF0B',
          'editorIndentGuide.activeBackground': '#FFFFFF1A',
          'editorGutter.background': '#0E121C',
        },
      });
      monaco.editor.setTheme('algoarena-dark');
    }} />
  </div>;
}

function ResultPanel({ result, pending, error, verdictLabel }: { result: SubmissionResult | null; pending: boolean; error: string; verdictLabel: (verdict: string) => string }) {
  return <div className="min-h-[125px] border-t border-white/[.07] bg-[#0b0f18] px-4 py-3">
    <div className="mb-2 flex items-center justify-between"><div className="mono flex items-center gap-2 text-[9px] tracking-[.04em] text-slate-500"><Radio size={12} className="text-blue-300" />채점 결과</div>{pending && <span className="mono flex items-center gap-1.5 text-[9px] text-blue-300"><LoaderCircle size={11} className="animate-spin" />채점 중</span>}</div>
    {error ? <p data-testid="text-judge-error" className="text-xs text-red-300">{error}</p> : result ? <div data-testid="status-verdict" className="flex items-start justify-between gap-3">
      <div><div className={`text-xs font-bold tracking-wide ${result.verdict === 'AC' ? 'text-emerald-300' : 'text-red-300'}`}>{verdictLabel(result.verdict)}</div><p className="mt-1 text-[10px] leading-4 text-slate-400">{result.message}</p>{result.output && <pre className="mono mt-2 max-h-12 overflow-auto whitespace-pre-wrap text-[9px] text-slate-500">{result.output}</pre>}</div>
      <div className="mono shrink-0 text-right text-[9px] text-slate-500"><div>{result.passed}/{result.total}개 테스트</div><div className="mt-1">{result.runtimeMs}ms</div>{result.damageDealt > 0 && <div className="mt-1 text-red-300">상대에게 −{result.damageDealt} 피해</div>}</div>
    </div> : <div className="flex h-[68px] items-center text-[11px] text-slate-600">{pending ? '코드를 채점하고 있습니다…' : '공개 테스트를 실행하거나 제출해 상대를 공격하세요.'}</div>}
  </div>;
}

function PlayerStrip({ player, label, tone }: { player?: Battle['players'][number]; label: string; tone: 'blue' | 'purple' }) {
  const color = tone === 'blue' ? 'text-blue-300' : 'text-purple-300';
  return <div className="min-w-0"><div className="mono truncate text-[8px] tracking-[.04em] text-slate-600">{label} · {player?.name ?? '대기 중'}</div><div className="mt-1 flex items-center gap-2"><span className={`mono text-[10px] ${color}`}>{player?.points ?? 0}점</span><div className="flex gap-0.5">{Array.from({ length: 3 }, (_, index) => <Heart key={index} size={10} className={index < (player?.hearts ?? 0) ? 'fill-red-400 text-red-400' : 'text-slate-700'} />)}</div><span className="mono text-[8px] text-slate-600">{Math.min(player?.currentChallengeIndex ?? 0, 3)}/3</span></div></div>;
}

function ResultOverlay({ winner, me, elapsedSeconds, onLobby, onReplay }: { winner?: Battle['players'][number]; me?: Battle['players'][number]; elapsedSeconds: number; onLobby: () => void; onReplay: () => void }) {
  const won = winner?.id === me?.id;
  return <div className="fixed inset-0 z-40 grid place-items-center bg-[#080a11]/85 p-5 backdrop-blur-sm"><div className="relative w-full max-w-[430px] overflow-hidden rounded-2xl border border-white/[.12] bg-[#111622] p-8 text-center shadow-2xl">
    <div className={`absolute inset-x-0 top-0 h-[2px] ${won ? 'bg-blue-400' : 'bg-purple-400'}`} />
    <div className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl border ${won ? 'border-blue-400/30 bg-blue-500/10 text-blue-300' : 'border-purple-400/30 bg-purple-500/10 text-purple-300'}`}><Swords size={24} /></div>
    <div className="mono mt-5 text-[9px] tracking-[.08em] text-slate-500">대결 종료</div>
    <h2 data-testid="text-match-result" className="mt-2 text-4xl font-bold tracking-[-.06em] text-slate-100">{won ? '승리!' : winner ? '패배' : '무승부'}</h2>
    <p className="mt-2 text-sm text-slate-400">{winner ? `${winner.name} 님이 대결에서 승리했습니다.` : '이번 대결은 무승부입니다.'}</p>
    <div className="my-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[.07] bg-white/[.08]">
      <div className="bg-[#111622] py-3"><div className="mono text-[8px] tracking-[.04em] text-slate-600">획득 점수</div><div data-testid="text-final-points" className="mt-1 text-xl font-semibold text-blue-300">{me?.points ?? 0}점</div></div>
      <div className="bg-[#111622] py-3"><div className="mono text-[8px] tracking-[.04em] text-slate-600">남은 하트</div><div className="mt-1 text-xl font-semibold text-red-300">{me?.hearts ?? 0}<span className="ml-1 text-xs text-slate-500">/ 3</span></div></div>
      <div className="bg-[#111622] py-3"><div className="mono text-[8px] tracking-[.04em] text-slate-600">경과 시간</div><div data-testid="text-final-time" className="mt-1 text-sm font-semibold text-slate-200">{formatTime(elapsedSeconds)}</div></div>
      <div className="bg-[#111622] py-3"><div className="mono text-[8px] tracking-[.04em] text-slate-600">제출 횟수</div><div data-testid="text-final-submissions" className="mt-1 text-sm font-semibold text-slate-200">{me?.submissions ?? 0}회</div></div>
    </div>
    <div className="flex gap-2"><button data-testid="button-result-lobby" onClick={onLobby} className="flex-1 rounded-lg border border-white/[.11] px-4 py-3 text-xs font-semibold text-slate-300 hover:bg-white/[.04]">대기실로</button><button data-testid="button-result-replay" onClick={onReplay} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-3 text-xs font-bold text-white hover:bg-blue-400"><RotateCcw size={13} />다른 문제 선택</button></div>
  </div></div>;
}

function BattleSkeleton() {
  return <main className="min-h-[100dvh] bg-[#0B0E17]"><div className="h-[62px] border-b border-white/[.07] bg-[#0d111c]" /><div className="h-[70px] animate-pulse border-b border-white/[.04] bg-white/[.015]" /><div className="grid gap-4 p-4 md:grid-cols-2"><div className="h-[70vh] animate-pulse rounded-xl bg-white/[.035]" /><div className="h-[70vh] animate-pulse rounded-xl bg-white/[.035]" /></div></main>;
}
