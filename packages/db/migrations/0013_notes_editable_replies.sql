ALTER TABLE notes
  ADD COLUMN updated_at TIMESTAMPTZ,
  ADD COLUMN updated_by_user_id UUID REFERENCES users(id),
  ADD COLUMN parent_note_id UUID REFERENCES notes(id);

CREATE INDEX notes_parent_note_id_idx ON notes(parent_note_id);
