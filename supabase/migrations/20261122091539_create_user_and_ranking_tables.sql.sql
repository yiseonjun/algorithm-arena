/*
# Create user accounts, PT history, and match history tables

1. Plain-English explanation
- Adds account system backing for AlgoArena: users sign up with a username
  (아이디), nickname, and password. Passwords are stored as bcrypt hashes.
- Adds persistent PT (rating points), tier, and win/loss statistics per user.
- Adds an immutable ledger of every PT change (중복 지급 방지를 위한 원장).
- Adds a match history row recorded once per finished battle.

2. New Tables
- `app_users`
  - `id` (uuid, primary key, default gen_random_uuid())
  - `username` (text, unique, not null) — 로그인용 아이디
  - `nickname` (text, not null) — 게임 내 표시 이름
  - `password_hash` (text, not null) — bcrypt 해시
  - `pt` (integer, not null, default 0) — 랭크 포인트, 0 미만 불가 (CHECK)
  - `wins` / `losses` / `draws` (integer, not null, default 0)
  - `created_at`, `updated_at`
- `pt_history`
  - `id` (uuid, primary key)
  - `user_id` (uuid -> app_users.id, cascade)
  - `room_id` (text, not null)
  - `delta` (integer, not null) — 변화량 (+25/-15/0)
  - `result` (text, not null) — WIN/LOSS/DRAW
  - `pt_after` (integer, not null) — 변경 후 잔여 PT
  - `tier_after` (text, not null)
  - `created_at`
  - unique(room_id, user_id) — 중복 지급 방지의 최종 방어선
- `match_history`
  - `id` (uuid, primary key)
  - `room_id` (text, unique, not null) — 방당 한 번만 기록
  - `winner_user_id` (uuid, nullable -> app_users.id)
  - `created_at`

3. Modified Tables
- 없음 (신규 생성만 수행)

4. Security
- RLS enabled on all three tables.
- 이 앱은 자체 인증(아이디/비밀번호 + 서버 세션)을 사용하며 Supabase auth를
  사용하지 않으므로, 브라우저(anon/authenticated) 직접 접근 경로를 차단합니다:
  GRANT를 주지 않고 RLS 정책도 만들지 않습니다.
- 서버(API 서버)만 DATABASE_URL로 접근합니다.

5. Important notes
- pt CHECK (pt >= 0): PT가 0 미만으로 내려가지 않음.
- pt_history unique(room_id, user_id): 같은 방에서 PT 중복 지급 방지.
- match_history unique(room_id): 방당 결과 기록이 한 번만 생성됨.
*/

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  nickname text NOT NULL,
  password_hash text NOT NULL,
  pt integer NOT NULL DEFAULT 0 CHECK (pt >= 0),
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  draws integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pt_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  room_id text NOT NULL,
  delta integer NOT NULL,
  result text NOT NULL,
  pt_after integer NOT NULL,
  tier_after text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL UNIQUE,
  winner_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pt_history_user ON pt_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_users_pt ON app_users(pt DESC);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pt_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_history ENABLE ROW LEVEL SECURITY;