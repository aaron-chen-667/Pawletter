CREATE TABLE IF NOT EXISTS stations (
 id text PRIMARY KEY, name text NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('adopter','station')),
 station_id text REFERENCES stations(id), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((role='station' AND station_id IS NOT NULL) OR (role='adopter' AND station_id IS NULL))
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL
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
