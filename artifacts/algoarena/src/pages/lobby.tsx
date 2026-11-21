import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowDownRight, ArrowRight, Code2, Crosshair, LoaderCircle, Radio, Swords, Users } from 'lucide-react';
import { getHealthCheckQueryKey, useCreateBattle, useHealthCheck, useJoinBattle, useListChallenges } from '@workspace/api-client-react';
import type { Challenge } from '@workspace/api-client-react';

const difficultyStyle: Record<string, string> = {
  BRONZE: 'text-[#f2a56f] border-[#f2a56f]/25 bg-[#f2a56f]/[.08]',
  SILVER: 'text-[#bdc8dd] border-[#bdc8dd]/25 bg-[#bdc8dd]/[.08]',
  GOLD: 'text-[#f2cb69] border-[#f2cb69]/25 bg-[#f2cb69]/[.08]',
};

const difficultyLevels: Array<{
  difficulty: Challenge['difficulty'];
  tier: string;
  description: string;
}> = [
  { difficulty: 'BRONZE', tier: '초급자', description: '기본 공격과 간단한 리스트 문제' },
  { difficulty: 'SILVER', tier: '중급자', description: '정렬, 집계, 순차 처리 문제' },
  { difficulty: 'GOLD', tier: '상급자', description: '조건 분석과 시뮬레이션 문제' },
];

export default function Lobby() {
  const [, setLocation] = useLocation();
  const [selectedDifficulty, setSelectedDifficulty] = useState<Challenge['difficulty']>('BRONZE');
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [formError, setFormError] = useState('');
  const { data: challenges, isLoading, isError, refetch } = useListChallenges();
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30000 } });
  const createBattle = useCreateBattle();
  const joinBattle = useJoinBattle();
  const selectedLevel = difficultyLevels.find((level) => level.difficulty === selectedDifficulty);
  const selectedCount = challenges?.filter((challenge) => challenge.difficulty === selectedDifficulty).length ?? 0;

  const enterMatch = (session: { playerId: string; battle: { roomId: string } }) => {
    sessionStorage.setItem('algoarena-player-id', session.playerId);
    setLocation(`/battle/${encodeURIComponent(session.battle.roomId)}`);
  };

  const createRoom = () => {
    const name = playerName.trim();
    if (!name) return setFormError('아레나에 입장하려면 플레이어 이름을 입력해 주세요.');
    if (!selectedLevel || selectedCount < 3) return setFormError('문제가 3개 이상 등록된 단계를 선택해 주세요.');
    setFormError('');
    createBattle.mutate({ data: { difficulty: selectedDifficulty, playerName: name } }, {
      onSuccess: enterMatch,
      onError: () => setFormError('대결방을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.'),
    });
  };

  const joinRoom = () => {
    const name = playerName.trim();
    const code = roomCode.trim();
    if (!name || !code) return setFormError('이름과 방 코드를 모두 입력해 주세요.');
    setFormError('');
    joinBattle.mutate({ roomId: code, data: { playerName: name } }, {
      onSuccess: enterMatch,
      onError: () => setFormError('방에 참가하지 못했습니다. 방 코드가 맞는지 확인해 주세요.'),
    });
  };

  const busy = createBattle.isPending || joinBattle.isPending;

  return (
    <main className="noise arena-grid min-h-[100dvh] overflow-hidden">
      <div className="relative mx-auto max-w-[1440px] px-5 pb-20 pt-6 md:px-10">
        <header className="entrance flex items-center justify-between border-b border-white/[.08] pb-5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-blue-400/30 bg-blue-500/10 text-blue-300"><Crosshair size={19} /></div>
            <div>
              <div className="text-[15px] font-bold tracking-[.13em] text-slate-100">ALGO<span className="text-blue-400">ARENA</span></div>
              <div className="mono mt-0.5 text-[9px] tracking-[.21em] text-slate-500">실시간 알고리즘 대결</div>
            </div>
          </div>
          <div className="mono flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400" data-testid="status-api">
            <span className={`h-1.5 w-1.5 rounded-full ${health.data?.status ? 'bg-emerald-400' : health.isError ? 'bg-red-400' : 'bg-amber-400 pulse-dot'}`} />
            {health.isLoading ? '서버 연결 중' : health.isError ? '서비스에 연결할 수 없습니다' : '아레나 온라인'}
          </div>
        </header>

        <section className="entrance relative grid gap-12 pb-12 pt-12 md:grid-cols-[1.05fr_.95fr] md:items-end md:pb-16 md:pt-[74px]">
          <div className="pointer-events-none absolute right-0 top-8 hidden h-[340px] w-[440px] opacity-80 md:block" aria-hidden="true">
            <div className="absolute right-10 top-8 h-60 w-60 rounded-full border border-blue-400/15" />
            <div className="absolute right-[74px] top-[72px] h-44 w-44 rounded-full border border-purple-400/20" />
            <div className="absolute right-[118px] top-[116px] h-24 w-24 rounded-full bg-blue-500/[.07] ring-1 ring-blue-300/30" />
            <div className="absolute right-[154px] top-[152px] h-4 w-4 rounded-full bg-blue-400 shadow-[0_0_24px_5px_rgba(59,130,246,.35)]" />
            <div className="absolute right-[7px] top-[165px] h-px w-[350px] rotate-[-31deg] bg-gradient-to-r from-transparent via-blue-400/35 to-transparent" />
            <div className="absolute right-0 top-[265px] mono text-[9px] tracking-[.2em] text-slate-600">실시간 대전 시스템 / 01</div>
          </div>
          <div className="relative max-w-[680px]">
            <div className="mono mb-5 flex items-center gap-2 text-[10px] tracking-[.12em] text-blue-300"><span className="h-px w-7 bg-blue-400" />시간과 겨루고, 서로에게 도전하세요.</div>
            <h1 className="text-[clamp(2.8rem,7vw,6rem)] font-bold leading-[.95] tracking-[-.045em] text-slate-100">빠르게 풀고.<br /><span className="text-blue-400">먼저</span> 공격하라.</h1>
            <p className="mt-7 max-w-[420px] text-sm leading-6 text-slate-400">두 명의 플레이어, 하나의 Python 문제. 정답을 맞히면 상대의 체력을 깎습니다. 실시간 알고리즘 대결에 참여하세요.</p>
            <div className="mono mt-8 flex items-center gap-5 text-[10px] uppercase tracking-[.1em] text-slate-500">
              <span className="flex items-center gap-2"><Swords size={13} className="text-purple-400" /> 1대1 대결</span>
              <span className="flex items-center gap-2"><Radio size={13} className="text-blue-400" /> 실시간 공격</span>
              <span className="flex items-center gap-2"><Code2 size={13} className="text-emerald-400" /> Python</span>
            </div>
          </div>

          <div className="relative rounded-2xl border border-white/[.09] bg-[#111622]/90 p-5 shadow-2xl shadow-black/20 backdrop-blur md:p-6">
            <div className="mb-5 flex items-center justify-between">
              <div><div className="mono text-[9px] tracking-[.12em] text-blue-300">플레이어 정보</div><h2 className="mt-1 text-xl font-semibold text-slate-100">아레나 입장</h2></div>
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-purple-500/10 text-purple-300"><Users size={18} /></div>
            </div>
            <label className="mono mb-2 block text-[10px] tracking-[.08em] text-slate-500" htmlFor="player-name">플레이어 이름</label>
            <input id="player-name" data-testid="input-player-name" value={playerName} maxLength={24} onChange={(event) => setPlayerName(event.target.value)} placeholder="상대에게 표시할 이름을 입력하세요" className="h-11 w-full rounded-lg border border-white/10 bg-[#0b0e17] px-3 text-sm text-slate-100 outline-none transition focus:border-blue-400/60 focus:ring-2 focus:ring-blue-500/10 placeholder:text-slate-600" />
            <div className="my-5 h-px bg-white/[.07]" />
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="mono mb-2 block text-[10px] tracking-[.08em] text-slate-500" htmlFor="room-code">방 코드로 참가</label>
                <input id="room-code" data-testid="input-room-code" value={roomCode} onChange={(event) => setRoomCode(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && joinRoom()} placeholder="방 코드" className="mono h-11 w-full rounded-lg border border-white/10 bg-[#0b0e17] px-3 text-xs uppercase tracking-[.16em] text-slate-100 outline-none transition focus:border-purple-400/60 focus:ring-2 focus:ring-purple-500/10 placeholder:text-slate-600" />
              </div>
              <button data-testid="button-join-room" onClick={joinRoom} disabled={busy} className="mt-auto flex h-11 items-center justify-center gap-2 rounded-lg border border-purple-400/35 bg-purple-500/[.11] px-4 text-xs font-semibold text-purple-200 transition hover:bg-purple-500/20 disabled:cursor-wait disabled:opacity-50">{joinBattle.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <ArrowRight size={14} />} 방 참가</button>
            </div>
            {formError && <p data-testid="text-form-error" className="mt-3 text-xs text-red-300">{formError}</p>}
          </div>
        </section>

        <section className="entrance-delay border-t border-white/[.08] pt-7">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div><div className="mono flex items-center gap-2 text-[9px] tracking-[.12em] text-purple-300"><span className="h-px w-5 bg-purple-400" />대결 대기열</div><h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">배틀 단계 선택</h2><p className="mt-1 text-xs text-slate-500">브론즈·실버·골드 중 하나를 고르면, 해당 단계의 5문제 중 3문제를 무작위로 뽑습니다.</p></div>
            {selectedLevel && <div className="mono rounded-md border border-white/[.08] bg-white/[.025] px-3 py-2 text-[10px] text-slate-400">선택한 단계 <span className="ml-2 text-slate-200">{selectedDifficulty} · 3문제</span></div>}
          </div>
          {isLoading ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0,1,2].map((item) => <div key={item} className="h-[154px] animate-pulse rounded-xl border border-white/[.06] bg-white/[.025]" />)}</div> :
          isError ? <div className="flex flex-col items-start gap-3 rounded-xl border border-red-400/20 bg-red-500/[.04] p-6"><p className="text-sm text-slate-300">문제 목록을 불러오지 못했습니다.</p><button data-testid="button-retry-challenges" onClick={() => refetch()} className="rounded-lg border border-red-300/20 px-3 py-2 text-xs text-red-200 hover:bg-red-400/10">다시 불러오기</button></div> :
          !challenges?.length ? <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">아직 등록된 문제가 없습니다.</div> :
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{difficultyLevels.map((level) => <DifficultyCard key={level.difficulty} difficulty={level.difficulty} tier={level.tier} description={level.description} problemCount={challenges?.filter((challenge) => challenge.difficulty === level.difficulty).length ?? 0} selected={level.difficulty === selectedDifficulty} onSelect={() => setSelectedDifficulty(level.difficulty)} />)}</div>}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button data-testid="button-create-room" onClick={createRoom} disabled={busy || selectedCount < 3} className="flex h-12 items-center justify-center gap-3 rounded-lg bg-blue-500 px-6 text-sm font-bold text-white shadow-lg shadow-blue-950/30 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-45">
              {createBattle.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Swords size={16} />}
              {createBattle.isPending ? '무작위 문제를 고르는 중…' : '무작위 3문제 배틀 시작'} <ArrowDownRight size={15} className="opacity-70" />
            </button>
            <span className="mono text-[9px] tracking-[.06em] text-slate-600">방 코드가 생성되면 상대에게 공유하세요</span>
          </div>
        </section>
        <footer className="mono mt-12 flex items-center justify-between border-t border-white/[.07] pt-4 text-[9px] tracking-[.08em] text-slate-600"><span>ALGOARENA / 대전 규칙 01</span><span>압박 속에서도 풀어내세요</span></footer>
      </div>
    </main>
  );
}

function DifficultyCard({ difficulty, tier, description, problemCount, selected, onSelect }: { difficulty: Challenge['difficulty']; tier: string; description: string; problemCount: number; selected: boolean; onSelect: () => void }) {
  const name = { BRONZE: '브론즈', SILVER: '실버', GOLD: '골드' }[difficulty] ?? difficulty;
  return <button data-testid={`card-level-${difficulty.toLowerCase()}`} onClick={onSelect} className={`group relative min-h-[150px] rounded-xl border p-4 text-left transition duration-200 ${selected ? 'border-blue-400/45 bg-blue-500/[.075] shadow-[inset_0_0_0_1px_rgba(59,130,246,.08)]' : 'border-white/[.08] bg-[#101520]/80 hover:border-white/20 hover:bg-[#141a28]'}`}>
    <div className="flex items-center justify-between"><span className={`mono rounded border px-2 py-1 text-[9px] tracking-[.04em] ${difficultyStyle[difficulty] ?? 'text-slate-300 border-white/10'}`}>{name}</span><span className="mono text-[10px] text-slate-500">{problemCount}문제</span></div>
    <h3 className="mt-4 text-base font-semibold text-slate-100">{name}</h3>
    <p className="mt-1 text-xs leading-5 text-slate-500">{tier} · {description}</p>
    <div className="mt-3 flex items-center justify-between"><span className="mono text-[9px] tracking-[.04em] text-slate-600">5문제 중 3개 무작위 선정</span><span className={`h-2 w-2 rounded-full ${selected ? 'bg-blue-400 shadow-[0_0_10px_rgba(59,130,246,.8)]' : 'bg-slate-700'}`} /></div>
  </button>;
}
