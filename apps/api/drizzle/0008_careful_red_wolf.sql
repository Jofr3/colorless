ALTER TABLE `cards` ADD `print_key` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `legal_standard_effective` integer;--> statement-breakpoint
ALTER TABLE `cards` ADD `legal_expanded_effective` integer;--> statement-breakpoint
CREATE INDEX `cards_print_key_idx` ON `cards` (`print_key`);