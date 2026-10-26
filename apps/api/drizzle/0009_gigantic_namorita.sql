DROP INDEX `cards_set_id_idx`;--> statement-breakpoint
DROP INDEX `cards_name_idx`;--> statement-breakpoint
CREATE INDEX `cards_set_local_idx` ON `cards` (`set_id`,`local_id`);--> statement-breakpoint
CREATE INDEX `cards_name_set_local_idx` ON `cards` (`name`,`set_id`,`local_id`);--> statement-breakpoint
CREATE INDEX `cards_name_lower_idx` ON `cards` (lower("name"),`set_id`,`local_id`);