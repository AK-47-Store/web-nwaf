-- N2flix shared product catalog and product image storage.
-- Run once in Supabase: SQL Editor -> New query -> Run.

create table if not exists public.storefront_catalog (
  id smallint primary key default 1 check (id = 1),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.storefront_catalog enable row level security;
revoke all on public.storefront_catalog from public;
grant select on public.storefront_catalog to anon, authenticated;
grant insert, update on public.storefront_catalog to authenticated;

drop policy if exists "Public can read the storefront catalog" on public.storefront_catalog;
create policy "Public can read the storefront catalog"
  on public.storefront_catalog for select to anon, authenticated
  using (id = 1);

drop policy if exists "Store admins can insert the storefront catalog" on public.storefront_catalog;
create policy "Store admins can insert the storefront catalog"
  on public.storefront_catalog for insert to authenticated
  with check (id = 1 and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'store_admin');

drop policy if exists "Store admins can update the storefront catalog" on public.storefront_catalog;
create policy "Store admins can update the storefront catalog"
  on public.storefront_catalog for update to authenticated
  using (id = 1 and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'store_admin')
  with check (id = 1 and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'store_admin');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'n2flix-catalog',
  'n2flix-catalog',
  true,
  20971520,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

grant select on storage.objects to anon, authenticated;
grant insert, update, delete on storage.objects to authenticated;

drop policy if exists "Public can view N2flix catalog images" on storage.objects;
create policy "Public can view N2flix catalog images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'n2flix-catalog');

drop policy if exists "Store admins can upload N2flix catalog images" on storage.objects;
create policy "Store admins can upload N2flix catalog images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'n2flix-catalog' and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'store_admin');

drop policy if exists "Store admins can update N2flix catalog images" on storage.objects;
create policy "Store admins can update N2flix catalog images"
  on storage.objects for update to authenticated
  using (bucket_id = 'n2flix-catalog' and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'store_admin')
  with check (bucket_id = 'n2flix-catalog' and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'store_admin');

drop policy if exists "Store admins can delete N2flix catalog images" on storage.objects;
create policy "Store admins can delete N2flix catalog images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'n2flix-catalog' and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'store_admin');

-- After creating the admin user in Authentication -> Users, replace the email below
-- and run this once to grant the storefront-only admin role.
-- update auth.users
-- set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"store_admin"}'::jsonb
-- where email = 'YOUR-ADMIN-EMAIL@example.com';
