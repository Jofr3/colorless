CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`set_id` text NOT NULL,
	`local_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`illustrator` text,
	`rarity` text,
	`regulation_mark` text,
	`hp` integer,
	`stage` text,
	`evolve_from` text,
	`types_json` text,
	`retreat` integer,
	`abilities_json` text,
	`attacks_json` text,
	`weaknesses_json` text,
	`resistances_json` text,
	`trainer_type` text,
	`energy_type` text,
	`effect` text,
	`legal_standard` integer NOT NULL,
	`legal_expanded` integer NOT NULL,
	`variants_json` text,
	`image_r2_url` text,
	`updated` text,
	FOREIGN KEY (`set_id`) REFERENCES `sets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cards_set_id_idx` ON `cards` (`set_id`);--> statement-breakpoint
CREATE INDEX `cards_name_idx` ON `cards` (`name`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`release_date` text,
	`logo_r2_url` text
);
--> statement-breakpoint
CREATE TABLE `sets` (
	`id` text PRIMARY KEY NOT NULL,
	`serie_id` text NOT NULL,
	`name` text NOT NULL,
	`logo_r2_url` text,
	`symbol_r2_url` text,
	`release_date` text NOT NULL,
	`count_total` integer NOT NULL,
	`count_official` integer NOT NULL,
	`legal_standard` integer NOT NULL,
	`legal_expanded` integer NOT NULL,
	`tcg_online` text,
	FOREIGN KEY (`serie_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sets_serie_id_idx` ON `sets` (`serie_id`);--> statement-breakpoint
CREATE TABLE `deck_cards` (
	`deck_id` text NOT NULL,
	`card_id` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`deck_id`, `card_id`),
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`folder_id` text,
	`name` text NOT NULL,
	`format` text,
	`tint` integer NOT NULL,
	`updated` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `decks_user_id_idx` ON `decks` (`user_id`);--> statement-breakpoint
CREATE INDEX `decks_folder_id_idx` ON `decks` (`folder_id`);--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `folders_user_id_idx` ON `folders` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_identities` (
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`provider`, `provider_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_identities_user_id_idx` ON `oauth_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);