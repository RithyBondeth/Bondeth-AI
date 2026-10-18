"""Persistent generated audio library.

Revision ID: b3d74a1e920c
Revises: a19f67c230bd
"""
from alembic import op
import sqlalchemy as sa

revision = "b3d74a1e920c"
down_revision = "a19f67c230bd"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "generated_audio",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.func.gen_random_uuid()),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("voice", sa.String(100), nullable=False),
        sa.Column("language", sa.String(10), nullable=False),
        sa.Column("speed", sa.Float(), nullable=False),
        sa.Column("duration", sa.Float(), nullable=False),
        sa.Column("engine", sa.String(40), nullable=False),
        sa.Column("notice", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_generated_audio_user_id", "generated_audio", ["user_id"])


def downgrade():
    op.drop_table("generated_audio")
