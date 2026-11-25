ALTER TABLE invitations ADD COLUMN voter_name TEXT CHECK(voter_name IS NULL OR length(trim(voter_name)) BETWEEN 1 AND 80);
