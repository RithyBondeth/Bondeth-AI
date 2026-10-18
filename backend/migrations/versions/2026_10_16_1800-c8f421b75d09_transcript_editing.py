"""Persist transcript timing and revisioned edits.

Revision ID: c8f421b75d09
Revises: b3d74a1e920c
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c8f421b75d09"
down_revision = "b3d74a1e920c"
branch_labels = None
depends_on = None


def upgrade():
    # NULL distinguishes old records whose original timestamps cannot be recovered.
    op.add_column("transcriptions", sa.Column("segments", postgresql.JSONB(), nullable=True))
    op.add_column("transcriptions", sa.Column("segmented_text", sa.Text(), nullable=True))
    op.add_column("transcriptions", sa.Column("revision", sa.Integer(), server_default="1", nullable=False))
    op.add_column("transcriptions", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    for name in ("updated_at", "revision", "segmented_text", "segments"):
        op.drop_column("transcriptions", name)
