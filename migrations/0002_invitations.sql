CREATE TABLE invitations(poll TEXT NOT NULL REFERENCES polls(id), code_hash TEXT NOT NULL, PRIMARY KEY(poll, code_hash));
ALTER TABLE ballots ADD COLUMN invitation TEXT;
CREATE UNIQUE INDEX ballot_invitation ON ballots(poll, invitation) WHERE invitation IS NOT NULL;
