CREATE TABLE IF NOT EXISTS stations (
 id text PRIMARY KEY, name text NOT NULL
);
-- Anonymous onboarding speech has a shared, bounded budget across all instances.
-- No audio, transcript, IP address or identity is stored in these counters.
CREATE TABLE IF NOT EXISTS onboarding_speech_budget (
 bucket text PRIMARY KEY, used integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('adopter','station')),
 station_id text REFERENCES stations(id), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((role='station' AND station_id IS NOT NULL) OR (role='adopter' AND station_id IS NULL))
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS read_all_stations boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS adopter_profiles (
 user_id text PRIMARY KEY REFERENCES users(id),registration_key text UNIQUE NOT NULL,
 nickname text NOT NULL,real_name text NOT NULL,phone text NOT NULL,wechat text NOT NULL DEFAULT '',email text NOT NULL DEFAULT '',
 lifestyle jsonb NOT NULL,verification text NOT NULL DEFAULT 'pending' CHECK(verification IN ('pending','verified','rejected')),
 covenant_version text NOT NULL,accepted_at timestamptz NOT NULL DEFAULT now(),proactive_enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS pets (
 id text PRIMARY KEY, station_id text NOT NULL REFERENCES stations(id), name text NOT NULL,
 profile jsonb NOT NULL DEFAULT '{}', published boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media (
 id text PRIMARY KEY, pet_id text NOT NULL REFERENCES pets(id), owner_id text NOT NULL REFERENCES users(id),
 object_name text UNIQUE NOT NULL, mime text NOT NULL, size integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pet_agents (
 pet_id text PRIMARY KEY REFERENCES pets(id),voice jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS observations (
 id text PRIMARY KEY, pet_id text NOT NULL REFERENCES pets(id), author_id text NOT NULL REFERENCES users(id),
 idempotency_key text NOT NULL, request_hash text NOT NULL,
 original_text text NOT NULL DEFAULT '', media_id text REFERENCES media(id),
 share_with_agent boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','archived','failed','withdrawn')),
 transcript text, attempts integer NOT NULL DEFAULT 0, lease_token text, lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), error_code text,
 replaces_id text REFERENCES observations(id), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(author_id,idempotency_key),
 CHECK (length(original_text)>0 OR media_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS observations_queue_idx ON observations(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS knowledge (
 id text PRIMARY KEY, observation_id text NOT NULL REFERENCES observations(id),
 pet_id text NOT NULL REFERENCES pets(id), topic text NOT NULL,
 quote text NOT NULL, certainty text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_pet_idx ON knowledge(pet_id);
CREATE TABLE IF NOT EXISTS chats (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), pet_id text NOT NULL REFERENCES pets(id),
 question text NOT NULL, answer text NOT NULL, citations jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_events (
 id text PRIMARY KEY, actor_id text, action text NOT NULL, target_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS adoption_applications (
 id text PRIMARY KEY,pet_id text NOT NULL REFERENCES pets(id),adopter_id text NOT NULL REFERENCES users(id),
 station_id text NOT NULL REFERENCES stations(id),snapshot jsonb NOT NULL,note text NOT NULL,
 stage integer NOT NULL DEFAULT 0 CHECK(stage BETWEEN -1 AND 3),version integer NOT NULL DEFAULT 1,
 idempotency_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(adopter_id,idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS adoption_active ON adoption_applications(pet_id,adopter_id) WHERE stage>=0;
CREATE TABLE IF NOT EXISTS pet_intakes (
 id text PRIMARY KEY,author_id text NOT NULL REFERENCES users(id),pet_id text UNIQUE NOT NULL REFERENCES pets(id),
 request_hash text NOT NULL,source_text text NOT NULL,ocr_text text NOT NULL,observation_id text REFERENCES observations(id),created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE media ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT true;
ALTER TABLE media ADD COLUMN IF NOT EXISTS caption text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS media_batches (
 id text PRIMARY KEY,pet_id text NOT NULL REFERENCES pets(id),owner_id text NOT NULL REFERENCES users(id),request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rescue_followups (
 id text PRIMARY KEY,application_id text NOT NULL REFERENCES adoption_applications(id),due_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmation','attention','completed')),
 version integer NOT NULL DEFAULT 1,history jsonb NOT NULL DEFAULT '[]',idempotency_key text UNIQUE NOT NULL,request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS followup_active ON rescue_followups(application_id) WHERE status<>'completed';
