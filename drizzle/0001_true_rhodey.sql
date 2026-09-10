CREATE TABLE `websidian_llm_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`issue_id` text,
	`lane` text NOT NULL,
	`requested_model_id` text NOT NULL,
	`served_model_id` text,
	`prompt_version` text NOT NULL,
	`reasoning_effort` text NOT NULL,
	`evidence_count` integer NOT NULL,
	`input_characters` integer NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text NOT NULL,
	`first_token_ms` integer,
	`duration_ms` integer NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`reasoning_tokens` integer,
	`cached_tokens` integer,
	`total_tokens` integer,
	`provider_cost_microunits` integer,
	`provider_cost_unit` text NOT NULL,
	`provider_request_id` text,
	`attempts` integer NOT NULL,
	`finish_reason` text,
	`status` text NOT NULL,
	`fallback` integer NOT NULL,
	`error_stage` text
);
--> statement-breakpoint
CREATE INDEX `websidian_llm_runs_owner_started` ON `websidian_llm_runs` (`owner_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `websidian_llm_runs_owner_lane` ON `websidian_llm_runs` (`owner_id`,`lane`);