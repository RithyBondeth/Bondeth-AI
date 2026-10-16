"""Subscription state, webhook receipts and idempotent job history.

Revision ID: a19f67c230bd
Revises: 7e0eeefbef8c
"""
from alembic import op
import sqlalchemy as sa

revision = "a19f67c230bd"
down_revision = "7e0eeefbef8c"
branch_labels = None
depends_on = None


def upgrade():
    for name, size in (("stripe_customer_id", 255), ("stripe_subscription_id", 255),
                       ("stripe_checkout_id", 255), ("subscription_status", 40),
                       ("subscription_price_id", 255)):
        op.add_column("users", sa.Column(name, sa.String(size), nullable=True))
    op.create_unique_constraint("uq_users_stripe_customer", "users", ["stripe_customer_id"])
    op.create_unique_constraint("uq_users_stripe_subscription", "users", ["stripe_subscription_id"])
    op.add_column("users", sa.Column("subscription_valid_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transcriptions", sa.Column("source_job_id", sa.String(32), nullable=True))
    op.create_unique_constraint("uq_transcriptions_source_job", "transcriptions", ["source_job_id"])
    op.create_table("billing_events",
                    sa.Column("id", sa.String(255), primary_key=True),
                    sa.Column("event_type", sa.String(100), nullable=False),
                    sa.Column("processed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))


def downgrade():
    op.drop_table("billing_events")
    op.drop_constraint("uq_transcriptions_source_job", "transcriptions", type_="unique")
    op.drop_column("transcriptions", "source_job_id")
    op.drop_constraint("uq_users_stripe_subscription", "users", type_="unique")
    op.drop_constraint("uq_users_stripe_customer", "users", type_="unique")
    for name in ("subscription_valid_until", "subscription_price_id", "subscription_status",
                 "stripe_checkout_id", "stripe_subscription_id", "stripe_customer_id"):
        op.drop_column("users", name)
