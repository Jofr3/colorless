ALTER TABLE `users` ADD `name_prompt` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- Hand-written backfill (security audit AU3, decision 12). Every existing account starts asked to
-- choose its public name; this clears the ask for the accounts whose name came neither from their
-- email nor from Google: a name that is not the email's local part (register's old default, and
-- Google sign-up's fallback) on an account with no OAuth identity (Google sign-up stored the real
-- name). Nothing records whether a linked account's name was typed or renamed since, so every
-- account with an identity is asked; keeping the current name is one press. No name changes here.
UPDATE `users` SET `name_prompt` = 0
WHERE lower(trim(`display_name`)) <> lower(substr(`email`, 1, instr(`email`, '@') - 1))
  AND NOT EXISTS (SELECT 1 FROM `oauth_identities` WHERE `oauth_identities`.`user_id` = `users`.`id`);
