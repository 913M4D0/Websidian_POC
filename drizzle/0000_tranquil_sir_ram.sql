CREATE TABLE `websidian_memory_artifacts` (
	`owner_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`content_hash` text NOT NULL,
	`compile_status` text NOT NULL,
	`embedding_status` text NOT NULL,
	`embedding_model` text,
	`dimensions` integer,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `issue_id`)
);
--> statement-breakpoint
CREATE INDEX `websidian_memory_artifacts_owner_status` ON `websidian_memory_artifacts` (`owner_id`,`embedding_status`);