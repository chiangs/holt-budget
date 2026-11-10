-- The family's facts and the change log (decision 0047, part 2).
--
-- Replaces the household table from 0001. Nothing ever wrote a row to it, because Setup is Milestone 6, so
-- nothing is lost. The guard below fails the migration, and so the app's start, if a row is there after all,
-- instead of dropping the family's data without a word.
--
-- Change records outlive row shapes. A stored change holds the rows it touched, as the Facts types had them
-- on the day it was written, and undo applies them years later. So a migration that reshapes a Facts table
-- must, in the same migration, rewrite or delete the records in `changes` that touch it, and say which in its
-- own header. This migration creates `changes`, so no record exists yet that it could break. The test
-- `migration.test.ts` loads a frozen record and undoes it after migrating, so a future migration that forgets
-- this fails there.
--
-- One Facts row is one SQL row. Each tagged union that only ever travels whole is one JSON column: a
-- transaction's treatment (a split's allocations live inside it, so a split and its transaction can't be
-- written apart), a job's plan and target, a rule's result, and an import row's original text. Every foreign
-- key is deferrable and initially deferred, so a patch applies in any order and the database checks it at
-- commit, as a second wall behind core's checkFacts.

create table _migration_guard (household_was_empty integer not null check (household_was_empty = 1));
insert into _migration_guard select case when exists (select 1 from household) then 0 else 1 end;
drop table _migration_guard;

drop table household;

create table household (
  id text primary key not null,
  name text not null,
  currency text not null check (length(currency) = 3 and currency not glob '*[^A-Z]*'),
  plan_start text not null check (plan_start glob '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  even_out_step integer not null check (even_out_step >= 0)
) strict;
create unique index household_single on household ((1));

create table accounts (
  id text primary key not null,
  name text not null,
  kind text not null check (kind in ('everyday', 'bills', 'savings', 'loan')),
  scope text not null check (scope in ('shared', 'paidInto')),
  opening_balance integer not null,
  opening_date text not null,
  number text unique check (number is null or (length(number) = 11 and number not glob '*[^0-9]*')),
  import_rhythm text check (import_rhythm in ('weekly', 'fortnightly', 'monthly'))
) strict;

create table groups (
  id text primary key not null,
  name text not null,
  position integer not null check (position >= 0),
  counts_towards_savings_rate integer not null check (counts_towards_savings_rate in (0, 1))
) strict;

create table jobs (
  id text primary key not null,
  name text not null,
  group_id text not null references groups (id) deferrable initially deferred,
  status text not null check (status in ('active', 'paused', 'finished', 'archived')),
  account_id text not null references accounts (id) deferrable initially deferred,
  essential integer not null check (essential in (0, 1)),
  opening integer not null,
  kind text not null check (kind in ('spend', 'saveUp', 'payInto')),
  keeps_money integer check (keeps_money in (0, 1)),
  plan text check (json_valid(plan)),
  seasonality text check (seasonality in ('auto', 'seasonal', 'irregular')),
  role text check (role in ('buffer', 'ordinary')),
  target text check (json_valid(target)),
  monthly integer,
  pay_into text references accounts (id) deferrable initially deferred,
  check (
    (kind = 'spend' and keeps_money is not null and plan is not null and seasonality is not null
      and role is null and target is null and monthly is null and pay_into is null)
    or (kind = 'saveUp' and role is not null and target is not null
      and keeps_money is null and plan is null and seasonality is null and monthly is null and pay_into is null)
    or (kind = 'payInto' and monthly is not null and pay_into is not null
      and keeps_money is null and plan is null and seasonality is null and role is null and target is null)
  )
) strict;

create table budget_months (
  month text primary key not null,
  state text not null check (state in ('open', 'closed', 'reopened'))
) strict;

create table assignments (
  month text not null,
  job_id text not null references jobs (id) deferrable initially deferred,
  amount integer not null,
  primary key (month, job_id)
) strict;
create index assignments_job on assignments (job_id);

create table rules (
  id text primary key not null,
  counterparty text not null,
  account_id text references accounts (id) deferrable initially deferred,
  min_amount integer,
  max_amount integer,
  result text not null check (json_valid(result)),
  origin text not null check (origin in ('set', 'learned', 'accepted')),
  priority integer not null
) strict;

create table transactions (
  id text primary key not null,
  account_id text not null references accounts (id) deferrable initially deferred,
  booking_date text not null,
  amount integer not null,
  description text not null,
  treatment text not null check (json_valid(treatment) and json_extract(treatment, '$.kind') in ('needsYou', 'income', 'transfer', 'split', 'history')),
  counterparty text,
  transaction_date text,
  reference text,
  note text,
  rule_id text references rules (id) deferrable initially deferred
) strict;
create index transactions_rule on transactions (rule_id);

create table moves (
  id text primary key not null,
  from_account text not null references accounts (id) deferrable initially deferred,
  to_account text not null references accounts (id) deferrable initially deferred,
  amount integer not null,
  month text not null,
  reason text not null,
  status text not null check (status in ('todo', 'done', 'skipped')),
  completed_by text references transactions (id) deferrable initially deferred
) strict;
create index moves_completed_by on moves (completed_by);

create table entered_values (
  id text primary key not null,
  kind text not null check (kind in ('reference', 'figure', 'asset', 'accountBalance', 'estimateOverride')),
  subject text not null,
  value real not null,
  unit text not null check (unit in ('money', 'months', 'percent', 'count')),
  as_of text not null,
  source text not null
) strict;

create table import_batches (
  id text primary key not null,
  file_name text not null,
  fingerprint text not null check (length(fingerprint) = 64 and fingerprint not glob '*[^0-9a-f]*'),
  format text not null,
  imported_at text not null,
  from_date text not null,
  to_date text not null,
  row_count integer not null check (row_count >= 0),
  created integer not null check (created >= 0),
  matched integer not null check (matched >= 0),
  pending integer not null check (pending >= 0),
  undone integer not null check (undone in (0, 1))
) strict;
-- The same file twice adds nothing, even if core is bypassed. A batch that was undone doesn't count.
create unique index import_batches_live_fingerprint on import_batches (fingerprint) where undone = 0;

create table import_rows (
  id text primary key not null,
  batch_id text not null references import_batches (id) deferrable initially deferred,
  line integer not null check (line >= 1),
  account_id text not null references accounts (id) deferrable initially deferred,
  booking_date text not null,
  interest_date text,
  description text not null,
  amount integer not null,
  counterpart_account text,
  counterpart_name text,
  reference text,
  bank_type text,
  original text check (json_valid(original)),
  fingerprint text not null,
  pending integer not null check (pending in (0, 1)),
  backs text references transactions (id) deferrable initially deferred
) strict;
-- One file backs a transaction at most once. Rows that back nothing are many, because NULLs differ.
create unique index import_rows_backs_once on import_rows (batch_id, backs);
create index import_rows_backs on import_rows (backs);

-- `status` is 'done' or 'undone'. Done rows ordered by seq ascending and undone rows ordered by seq descending
-- are the two stacks, so an undone seq is always above every done seq (see facts/changes.ts).
create table changes (
  seq integer primary key autoincrement not null,
  id text not null unique,
  at text not null,
  kind text not null,
  author text not null check (json_valid(author)),
  command text not null check (json_valid(command)),
  patch text not null check (json_valid(patch)),
  status text not null check (status in ('done', 'undone'))
) strict;
create index changes_top on changes (status, seq);
