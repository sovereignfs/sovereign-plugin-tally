CREATE TABLE "reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"from_member_id" text NOT NULL,
	"to_member_id" text NOT NULL,
	"sent_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_from_member_id_group_members_id_fk" FOREIGN KEY ("from_member_id") REFERENCES "group_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_to_member_id_group_members_id_fk" FOREIGN KEY ("to_member_id") REFERENCES "group_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_group_id_idx" ON "reminders" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "reminders_from_to_idx" ON "reminders" USING btree ("from_member_id","to_member_id");