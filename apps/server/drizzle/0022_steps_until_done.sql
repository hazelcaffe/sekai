-- Bots work until a task is done now: the old default of 24 steps per reply (which stopped long tasks halfway) becomes
-- the new safety limit of 200. A different number someone chose stays as it is.
UPDATE "agents" SET "models" = jsonb_set("models", '{maxSteps}', '200') WHERE "models"->>'maxSteps' = '24';
