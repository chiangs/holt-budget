-- People, contribution agreements and bucket transfers (decision 0048).
--
-- Adds three tables. It reshapes no table that exists, so no record in `changes` is touched and none is
-- rewritten or deleted (see the header of 0002 for why that matters). A transaction's treatment gains an
-- optional `agreement` inside its JSON column when it is income from a contribution. That is an optional key
-- of a union that only ever travels whole, so the column, its CHECK and every stored row and change record
-- stay valid as they are. `migration.test.ts` migrates a version 2 database that holds a change record to
-- the latest version and undoes it.
--
-- Every foreign key is deferrable and initially deferred, as in 0002, and every child column of a foreign key
-- leads an index: a job, a person or an account is looked up in these tables whenever it is deleted, and
-- without the index each deletion is a scan (0047, finding 15).

create table people (
  id text primary key not null,
  name text not null,
  kind text not null check (kind in ('adult', 'child')),
  birth_month text check (birth_month glob '[0-9][0-9][0-9][0-9]-[01][0-9]')
) strict;

create table contribution_agreements (
  id text primary key not null,
  person_id text not null references people (id) deferrable initially deferred,
  account_id text not null references accounts (id) deferrable initially deferred,
  amount integer not null check (amount > 0),
  day integer not null check (day between 1 and 28),
  from_month text not null check (from_month glob '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  to_month text check (to_month glob '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  check (to_month is null or to_month >= from_month)
) strict;
create index contribution_agreements_person on contribution_agreements (person_id);
create index contribution_agreements_account on contribution_agreements (account_id);

create table bucket_transfers (
  id text primary key not null,
  month text not null check (month glob '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  from_job text not null references jobs (id) deferrable initially deferred,
  to_job text not null references jobs (id) deferrable initially deferred,
  amount integer not null check (amount > 0),
  reason text not null,
  check (from_job <> to_job)
) strict;
create index bucket_transfers_from_job on bucket_transfers (from_job);
create index bucket_transfers_to_job on bucket_transfers (to_job);
