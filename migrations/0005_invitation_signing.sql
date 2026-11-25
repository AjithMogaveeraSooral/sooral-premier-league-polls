CREATE TABLE invitation_signer(id INTEGER PRIMARY KEY CHECK(id=1), secret TEXT NOT NULL);
INSERT INTO invitation_signer(id,secret) VALUES(1,hex(randomblob(32)));
