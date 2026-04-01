-- Change the column default so new pipelines start as kanban
ALTER TABLE pipelines ALTER COLUMN default_view SET DEFAULT 'kanban';

-- Back-fill existing pipelines that were never explicitly changed from 'list'
UPDATE pipelines SET default_view = 'kanban' WHERE default_view = 'list';
