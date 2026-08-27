CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`from_member_id` text NOT NULL,
	`to_member_id` text NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_member_id`) REFERENCES `group_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_member_id`) REFERENCES `group_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reminders_group_id_idx` ON `reminders` (`group_id`);--> statement-breakpoint
CREATE INDEX `reminders_from_to_idx` ON `reminders` (`from_member_id`,`to_member_id`);