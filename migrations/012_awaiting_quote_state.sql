-- BR-05 / D-28: a custom cake's price comes from an owner quote, delivered
-- through a request, and the order is not confirmed until the quote resolves.
--
-- The build had it the other way round: bei_jumla was NOT NULL and the cashier
-- typed the price at the till. That inverts the authority the blueprint puts
-- with the owner, so the order now has a state for "described but not yet
-- priced" and the quote request is what moves it out of that state.
--
-- Prepended before 'ordered' so the enum reads in lifecycle order:
-- awaiting_quote -> ordered -> in_progress -> ready -> collected.
--
-- bei_jumla stays NOT NULL on purpose. Making it nullable would cascade into
-- the generated salio column and the deposit<=total check, and every balance
-- calculation downstream. An unquoted order simply carries 0, and the state
-- machine — not the number — is what says whether a price is real yet. The
-- guards in the resolver refuse to treat a 0 on a non-awaiting order as valid,
-- so the placeholder can never be read as a free cake.

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'awaiting_quote' BEFORE 'ordered';
