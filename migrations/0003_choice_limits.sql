ALTER TABLE polls ADD COLUMN min_choices INTEGER NOT NULL DEFAULT 1;
ALTER TABLE polls ADD COLUMN max_choices INTEGER;
UPDATE polls SET max_choices = CASE WHEN multi THEN json_array_length(options) ELSE 1 END;
