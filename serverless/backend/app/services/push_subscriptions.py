"""Persist browser Push endpoints, scoped to the currently authenticated user."""

import logging
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, insert, select
from sqlalchemy.exc import SQLAlchemyError

from app.db.retry import run_transaction_with_retry
from app.db.schema import push_subscriptions
from app.db.session import engine

logger = logging.getLogger(__name__)


class PushStoreError(Exception):
    """Subscription metadata could not be persisted or queried."""


def save_subscription(*, user_id, endpoint: str, p256dh: str, auth: str) -> None:
    """Associate an installation with this user, replacing any former owner."""
    try:
        def persist(connection):
            connection.execute(delete(push_subscriptions).where(push_subscriptions.c.endpoint == endpoint))
            connection.execute(insert(push_subscriptions).values(
                id=uuid4(), user_id=user_id, endpoint=endpoint, p256dh=p256dh,
                auth=auth, created_at=datetime.now(UTC),
            ))

        run_transaction_with_retry(engine, persist)
    except SQLAlchemyError as error:
        raise PushStoreError from error


def delete_subscription(*, user_id, endpoint: str) -> None:
    """Remove only the matching installation owned by the requesting user."""
    try:
        run_transaction_with_retry(
            engine,
            lambda connection: connection.execute(delete(push_subscriptions).where(
                push_subscriptions.c.endpoint == endpoint,
                push_subscriptions.c.user_id == user_id,
            )),
        )
    except SQLAlchemyError as error:
        raise PushStoreError from error


def subscriptions_for_users(user_ids):
    """Return active installation data for an already-resolved recipient set."""
    if not user_ids:
        return []
    try:
        with engine.connect() as connection:
            return connection.execute(
                select(push_subscriptions).where(push_subscriptions.c.user_id.in_(user_ids))
            ).mappings().all()
    except SQLAlchemyError as error:
        raise PushStoreError from error


def delete_expired_subscription(endpoint: str) -> None:
    """Remove an expired endpoint without exposing its value in logs."""
    try:
        run_transaction_with_retry(
            engine,
            lambda connection: connection.execute(delete(push_subscriptions).where(
                push_subscriptions.c.endpoint == endpoint,
            )),
        )
    except SQLAlchemyError:
        logger.exception("Could not remove expired Push subscription")
