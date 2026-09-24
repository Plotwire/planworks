-- ============================================================================
-- plan-images: stored files no drawing refers to
-- ----------------------------------------------------------------------------
-- >>> REPORT ONLY -- lists files, deletes nothing. <<<
--
-- Run by hand in Supabase -> SQL Editor, and decide from the list what, if
-- anything, to do. There is deliberately no DELETE in this file.
--
-- A drawing (a public.projects row) refers to its stored files through
-- data -> 'sheets' -> [each sheet] -> 'bgImage':
--   'path'     the plan image
--   'pdfPath'  the original PDF, when the plan was imported from one
-- Drawings saved before multi-sheet support keep one top-level
-- data -> 'bgImage' instead; that is checked too.
--
-- Files end up unreferenced because the app only deletes a file it is sure
-- nothing needs: replacing a plan keeps the old file, deleting a drawing from
-- the dashboard leaves its files, and deleting one in the editor keeps any
-- file another drawing (a Save As copy) still uses.
--
-- BEFORE ACTING ON THE LIST
--   * A file can be in use without any row pointing at it yet: a plan just
--     imported into a drawing that is open but unsaved, or one held in a
--     browser's crash-recovery draft. The `recent` column flags files from
--     the last 7 days; leave those alone.
--   * Remove files through the Storage API (the dashboard's Storage page, or
--     the client's .remove()), never with a SQL DELETE on storage.objects:
--     that does not remove the stored file itself.
-- ============================================================================


-- 1. Totals: how many unreferenced files, and how much space, per account.
--    The row with account = 'ALL ACCOUNTS' is the grand total.
with drawing_plans as (
  select s.sheet -> 'bgImage' as bg
    from public.projects p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.data -> 'sheets') = 'array' then p.data -> 'sheets' else '[]'::jsonb end
    ) as s(sheet)
  union all
  select p.data -> 'bgImage' from public.projects p
),
referenced as (
  select bg ->> 'path' as name from drawing_plans
  union
  select bg ->> 'pdfPath' from drawing_plans
),
orphans as (
  -- NOT EXISTS, not NOT IN: `referenced` contains NULLs, and NOT IN against
  -- a NULL matches nothing.
  select (storage.foldername(o.name))[1] as account,
         coalesce((o.metadata ->> 'size')::bigint, 0) as bytes
    from storage.objects o
   where o.bucket_id = 'plan-images'
     and not exists (select 1 from referenced r where r.name = o.name)
)
select case when grouping(account) = 1 then 'ALL ACCOUNTS' else account end as account,
       count(*)                   as files,
       pg_size_pretty(sum(bytes)) as size
  from orphans
 group by rollup (account)
 order by sum(bytes) desc;


-- 2. The list: every unreferenced file, oldest first.
--    account is the owner's user id (the first folder of the file's path).
with drawing_plans as (
  select s.sheet -> 'bgImage' as bg
    from public.projects p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.data -> 'sheets') = 'array' then p.data -> 'sheets' else '[]'::jsonb end
    ) as s(sheet)
  union all
  select p.data -> 'bgImage' from public.projects p
),
referenced as (
  select bg ->> 'path' as name from drawing_plans
  union
  select bg ->> 'pdfPath' from drawing_plans
)
select o.name,
       (storage.foldername(o.name))[1]                             as account,
       o.metadata ->> 'mimetype'                                   as type,
       pg_size_pretty(coalesce((o.metadata ->> 'size')::bigint, 0)) as size,
       o.created_at,
       o.created_at > now() - interval '7 days'                    as recent
  from storage.objects o
 where o.bucket_id = 'plan-images'
   and not exists (select 1 from referenced r where r.name = o.name)
 order by o.created_at;
