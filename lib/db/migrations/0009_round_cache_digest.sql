CREATE TABLE IF NOT EXISTS "QuestionDigestDaily" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "day" varchar(10) NOT NULL,
  "questionHash" varchar(64) NOT NULL,
  "normalizedQuestion" text NOT NULL,
  "userId" uuid NOT NULL,
  "chatId" uuid NOT NULL,
  "createdAt" timestamp NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "QuestionDigestDaily" ADD CONSTRAINT "QuestionDigestDaily_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "QuestionDigestDaily" ADD CONSTRAINT "QuestionDigestDaily_chatId_Chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."Chat"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "QuestionDigestDaily_day_hash_idx" ON "QuestionDigestDaily" USING btree ("day","questionHash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "QuestionDigestDaily_day_hash_user_idx" ON "QuestionDigestDaily" USING btree ("day","questionHash","userId");
