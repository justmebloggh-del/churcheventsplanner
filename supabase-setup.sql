-- Run this in your Supabase SQL Editor

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  venue text not null,
  date date not null,
  time time not null,
  duration integer not null default 60,
  recurring text not null default 'none',
  description text,
  address text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Only authenticated users can insert/update/delete
alter table events enable row level security;

create policy "Public can read events"
  on events for select using (true);

create policy "Admins can insert events"
  on events for insert with check (auth.uid() is not null);

create policy "Admins can update their events"
  on events for update using (auth.uid() is not null);

create policy "Admins can delete events"
  on events for delete using (auth.uid() is not null);
