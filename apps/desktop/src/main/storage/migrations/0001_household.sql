create table household (
  id text primary key not null,
  name text not null,
  currency text not null check (length(currency) = 3 and currency not glob '*[^A-Z]*'),
  created_at text not null
) strict;
