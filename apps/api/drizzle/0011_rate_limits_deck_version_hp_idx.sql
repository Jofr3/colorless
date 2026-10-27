CREATE TABLE `auth_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
DROP INDEX `cards_set_local_idx`;--> statement-breakpoint
CREATE INDEX `cards_pokemon_hp_idx` ON `cards` ((case when "category" = 'Pokemon' then "hp" end) desc,`set_id`,`local_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cards_set_local_idx` ON `cards` (`set_id`,`local_id`);--> statement-breakpoint
ALTER TABLE `decks` ADD `version` integer DEFAULT 0 NOT NULL;