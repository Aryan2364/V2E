-- Workflows: tracks.
--
-- Steps now live in TRACKS (src/workflows/tracks.ts). The Main track always exists;
-- within a track step N+1 waits for step N; another track starts after its split step
-- (or when the workflow starts); a step may also wait for steps in other tracks (a
-- merge). `depends_on_step_ids` stays what the engine reads, and is now derived from
-- the tracks on every save.
--
--  * workflow_templates.tracks (JSON): `[{ key, name, split_from_step_id }]`, main first.
--  * workflow_steps.track_key (TEXT, default 'main') and merge_step_ids (JSON).
--  * workflow_steps.order_index becomes the position WITHIN the step's track.
--
-- Every existing template's free-form graph is converted into tracks with the same
-- algorithm as `convertDagToTracks` (src/workflows/tracks.ts, unit-tested):
--   walk the steps in topological order (ties: order_index, created_at, id); a step's
--   primary predecessor is its dependency that comes first in that order; if the
--   primary's track has no step after it yet the step is appended to it, otherwise it
--   starts a new track split from the primary; a step with no dependencies starts the
--   main track if it is empty, else a new track that starts with the workflow; its
--   other dependencies become merges (one in its own track is already implied and is
--   dropped). Tracks are keyed B, C, … in creation order.
-- depends_on_step_ids is rewritten to the derived list — the same dependencies minus
-- the implied ones (and minus ids of steps that no longer exist), so every workflow
-- runs exactly as before. Runs keep their frozen snapshots. Additive; no data removed.

-- AlterTable
ALTER TABLE "workflow_templates" ADD COLUMN IF NOT EXISTS "tracks" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "workflow_steps" ADD COLUMN IF NOT EXISTS "track_key" TEXT NOT NULL DEFAULT 'main';
ALTER TABLE "workflow_steps" ADD COLUMN IF NOT EXISTS "merge_step_ids" JSONB NOT NULL DEFAULT '[]';

-- Convert every template's graph into tracks.
DROP TABLE IF EXISTS _wf_conv;
DROP TABLE IF EXISTS _wf_tracks;
CREATE TEMP TABLE _wf_conv (
  id      TEXT PRIMARY KEY,
  ord     INTEGER NOT NULL,
  created TIMESTAMP(3) NOT NULL,
  deps    TEXT[] NOT NULL,
  topo    INTEGER,
  track   TEXT,
  pos     INTEGER,
  merges  TEXT[] NOT NULL DEFAULT '{}'
);
CREATE TEMP TABLE _wf_tracks (
  key       TEXT PRIMARY KEY,
  idx       INTEGER NOT NULL,
  split     TEXT,
  last_step TEXT,
  n         INTEGER NOT NULL DEFAULT 0
);

DO $$
DECLARE
  tpl        RECORD;
  pick_id    TEXT;
  prim       TEXT;
  prim_track TEXT;
  my_track   TEXT;
  topo_n     INTEGER;
  n_tracks   INTEGER;
  x          INTEGER;
  r          INTEGER;
  k          TEXT;
BEGIN
  FOR tpl IN SELECT id FROM "workflow_templates" WHERE "tracks" = '[]'::jsonb LOOP
    TRUNCATE _wf_conv;
    TRUNCATE _wf_tracks;

    INSERT INTO _wf_conv (id, ord, created, deps)
    SELECT s.id, s.order_index, s.created_at,
           COALESCE(ARRAY(
             SELECT DISTINCT d.value #>> '{}'
             FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(s.depends_on_step_ids) = 'array' THEN s.depends_on_step_ids ELSE '[]'::jsonb END
                  ) AS d(value)
             WHERE jsonb_typeof(d.value) = 'string'
               AND (d.value #>> '{}') <> s.id
               AND EXISTS (
                 SELECT 1 FROM "workflow_steps" o
                 WHERE o.id = (d.value #>> '{}') AND o.workflow_template_id = tpl.id AND o.is_branch_step = false
               )
           ), '{}')
    FROM "workflow_steps" s
    WHERE s.workflow_template_id = tpl.id AND s.is_branch_step = false;

    INSERT INTO _wf_tracks (key, idx, split, last_step, n) VALUES ('main', 0, NULL, NULL, 0);
    n_tracks := 1;
    topo_n := 0;

    LOOP
      -- Next in topological order: every dependency placed; ties by order_index, created_at, id.
      pick_id := NULL;
      SELECT c.id INTO pick_id
      FROM _wf_conv c
      WHERE c.topo IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM unnest(c.deps) AS d(dep) JOIN _wf_conv p ON p.id = d.dep WHERE p.topo IS NULL
        )
      ORDER BY c.ord, c.created, c.id COLLATE "C"
      LIMIT 1;
      IF pick_id IS NULL THEN
        -- A loop (never saved by the app): break it at the earliest remaining step.
        SELECT c.id INTO pick_id FROM _wf_conv c WHERE c.topo IS NULL ORDER BY c.ord, c.created, c.id COLLATE "C" LIMIT 1;
        EXIT WHEN pick_id IS NULL;
      END IF;

      UPDATE _wf_conv SET topo = topo_n WHERE id = pick_id;
      topo_n := topo_n + 1;

      -- Primary predecessor: the placed dependency that comes first in topological order.
      prim := NULL;
      SELECT p.id INTO prim
      FROM _wf_conv c CROSS JOIN LATERAL unnest(c.deps) AS d(dep) JOIN _wf_conv p ON p.id = d.dep
      WHERE c.id = pick_id AND p.topo IS NOT NULL AND p.id <> pick_id
      ORDER BY p.topo
      LIMIT 1;

      my_track := NULL;
      IF prim IS NULL THEN
        IF (SELECT n FROM _wf_tracks WHERE key = 'main') = 0 THEN
          my_track := 'main';
        END IF;
      ELSE
        SELECT track INTO prim_track FROM _wf_conv WHERE id = prim;
        IF (SELECT last_step FROM _wf_tracks WHERE key = prim_track) = prim THEN
          my_track := prim_track;
        END IF;
      END IF;

      IF my_track IS NULL THEN
        -- A new track: key = bijective base 26 of (index + 1) → B, C, …, Z, AA, …
        x := n_tracks + 1;
        k := '';
        WHILE x > 0 LOOP
          r := (x - 1) % 26;
          k := chr(65 + r) || k;
          x := (x - 1) / 26;
        END LOOP;
        my_track := k;
        INSERT INTO _wf_tracks (key, idx, split, last_step, n) VALUES (my_track, n_tracks, prim, NULL, 0);
        n_tracks := n_tracks + 1;
      END IF;

      UPDATE _wf_conv c
      SET track = my_track,
          pos = (SELECT t.n FROM _wf_tracks t WHERE t.key = my_track),
          merges = COALESCE(ARRAY(
            SELECT p.id
            FROM unnest(c.deps) AS d(dep) JOIN _wf_conv p ON p.id = d.dep
            WHERE p.topo IS NOT NULL AND p.id <> pick_id AND p.id IS DISTINCT FROM prim AND p.track IS DISTINCT FROM my_track
            ORDER BY p.topo
          ), '{}')
      WHERE c.id = pick_id;

      UPDATE _wf_tracks SET n = n + 1, last_step = pick_id WHERE key = my_track;
    END LOOP;

    -- Write back: track, position, merges and the derived depends_on.
    UPDATE "workflow_steps" s
    SET track_key = c.track,
        order_index = c.pos,
        merge_step_ids = to_jsonb(c.merges),
        depends_on_step_ids = to_jsonb(
          (CASE
             WHEN c.pos = 0 THEN
               COALESCE((SELECT CASE WHEN c.track = 'main' OR t.split IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY[t.split] END
                         FROM _wf_tracks t WHERE t.key = c.track), ARRAY[]::TEXT[])
             ELSE ARRAY(SELECT p.id FROM _wf_conv p WHERE p.track = c.track AND p.pos = c.pos - 1)
           END) || c.merges
        )
    FROM _wf_conv c
    WHERE s.id = c.id;

    UPDATE "workflow_templates"
    SET tracks = (
      SELECT jsonb_agg(jsonb_build_object('key', t.key, 'name', NULL, 'split_from_step_id', t.split) ORDER BY t.idx)
      FROM _wf_tracks t
    )
    WHERE id = tpl.id;
  END LOOP;
END $$;

DROP TABLE IF EXISTS _wf_conv;
DROP TABLE IF EXISTS _wf_tracks;
