"""Tablas y migraciones aditivas que pertenecen al grupo."""

from sqlalchemy import Column, DateTime, Index, String, Table, Uuid, text


def register_tables(metadata):
    """Registra la tabla de suscripciones para todas las Lambdas y mantenimiento."""
    subscriptions = Table(
        "push_subscriptions",
        metadata,
        Column("id", Uuid(as_uuid=True), primary_key=True),
        Column("user_id", Uuid(as_uuid=True), nullable=False),
        Column("endpoint", String(500), nullable=False, unique=True),
        Column("p256dh", String(255), nullable=False),
        Column("auth", String(255), nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False,
               server_default=text("CURRENT_TIMESTAMP")),
    )
    Index("ix_push_subscriptions_user_id", subscriptions.c.user_id)
    return subscriptions


def migrate_schema(engine) -> None:
    """No se requiere ALTER: prepare_schema crea tabla e índice de forma idempotente."""
    del engine
