ALTER TABLE `decks` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `folders` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `decks` SET `position` = (
  SELECT COUNT(*) FROM `decks` AS `other`
  WHERE `other`.`user_id` = `decks`.`user_id`
    AND (`other`.`name` < `decks`.`name`
      OR (`other`.`name` = `decks`.`name` AND `other`.`id` < `decks`.`id`))
);--> statement-breakpoint
UPDATE `folders` SET `position` = (
  SELECT COUNT(*) FROM `folders` AS `other`
  WHERE `other`.`user_id` = `folders`.`user_id`
    AND (`other`.`name` < `folders`.`name`
      OR (`other`.`name` = `folders`.`name` AND `other`.`id` < `folders`.`id`))
);
