"""Private source recordings for transcript playback.

Revision ID: d9e5a207bc31
Revises: c8f421b75d09
"""
from alembic import op
import sqlalchemy as sa

revision = "d9e5a207bc31"
down_revision = "c8f421b75d09"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("transcriptions", sa.Column("source_audio_status", sa.String(20), nullable=False, server_default="not_saved"))
    op.add_column("transcriptions", sa.Column("source_audio_bytes", sa.BigInteger(), nullable=True))


def downgrade():
    op.drop_column("transcriptions", "source_audio_bytes")
    op.drop_column("transcriptions", "source_audio_status")
