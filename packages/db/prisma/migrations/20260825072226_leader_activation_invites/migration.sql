-- CreateTable
CREATE TABLE "activation_invites" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activation_invites_token_hash_key" ON "activation_invites"("token_hash");

-- CreateIndex
CREATE INDEX "activation_invites_user_id_expires_at_idx" ON "activation_invites"("user_id", "expires_at");

-- AddForeignKey
ALTER TABLE "activation_invites" ADD CONSTRAINT "activation_invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
