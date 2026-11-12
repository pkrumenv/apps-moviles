import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, insert, select
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.db.retry import run_transaction_with_retry
from app.db.schema import push_subscriptions
from app.db.session import engine
from app.services.notifications import ActivityNotification

logger = logging.getLogger(__name__)


class PushStoreError(Exception):
    """Push subscription metadata could not be persisted or queried."""


@dataclass(frozen=True)
class PushSubscription:
    id: UUID
    user_id: UUID
    endpoint: str
    p256dh: str
    auth: str
    created_at: datetime


def save_subscription(
    *, user_id: UUID, endpoint: str, p256dh: str, auth: str
) -> PushSubscription:
    """Create or refresh a subscription, keyed by its unique endpoint.

    A given browser/device endpoint is only ever associated with the most
    recently authenticated user (relogging in as someone else on the same
    browser must not keep sending that browser the previous user's pushes).
    """
    subscription_id = uuid4()
    timestamp = datetime.now(UTC)

    def persist(connection):
        connection.execute(
            delete(push_subscriptions).where(push_subscriptions.c.endpoint == endpoint)
        )
        connection.execute(
            insert(push_subscriptions).values(
                id=subscription_id,
                user_id=user_id,
                endpoint=endpoint,
                p256dh=p256dh,
                auth=auth,
                created_at=timestamp,
            )
        )

    try:
        run_transaction_with_retry(engine, persist)
    except SQLAlchemyError as error:
        raise PushStoreError from error

    return PushSubscription(
        id=subscription_id,
        user_id=user_id,
        endpoint=endpoint,
        p256dh=p256dh,
        auth=auth,
        created_at=timestamp,
    )


def delete_subscription(*, user_id: UUID, endpoint: str) -> None:
    """Remove a subscription. Scoped to user_id so one user can't drop another's."""

    def persist(connection):
        connection.execute(
            delete(push_subscriptions).where(
                push_subscriptions.c.endpoint == endpoint,
                push_subscriptions.c.user_id == user_id,
            )
        )

    try:
        run_transaction_with_retry(engine, persist)
    except SQLAlchemyError as error:
        raise PushStoreError from error


def _delete_subscription_by_endpoint(endpoint: str) -> None:
    """Drop a subscription regardless of owner (used for expired endpoints)."""

    def persist(connection):
        connection.execute(delete(push_subscriptions).where(push_subscriptions.c.endpoint == endpoint))

    try:
        run_transaction_with_retry(engine, persist)
    except SQLAlchemyError:
        logger.exception("Could not remove expired push subscription")


_ACTIVITY_COPY = {
    "visit": ("Nueva visita", "Alguien que sigues registró una visita."),
    "photo": ("Nueva foto", "Alguien que sigues publicó fotos."),
    "evaluation": ("Nueva evaluación", "Alguien que sigues evaluó un restaurante."),
}


def _activity_url(notification: ActivityNotification) -> str:
    """Return a client-side route that the React router can open directly."""
    if notification.type == "photo":
        # Photos may be published as one group whose activity id is not an
        # individual photo id. The feed is the stable, addressable view.
        return f"/feed?activity={notification.id}"

    route = {"visit": "visits", "review": "reviews", "evaluation": "evaluations"}.get(
        notification.type, "feed"
    )
    return f"/{route}/{notification.id}"


def send_activity_notification(notification: ActivityNotification) -> None:
    """Deliver one resolved activity to the recipients' active subscriptions.

    `notifications.notify` has already applied visibility, follow rules,
    author exclusion, and recipient deduplication. This function only maps
    those recipient ids to this group's Web Push subscriptions.
    """
    if not notification.recipients:
        return
    if notification.type == "review":
        logger.debug("Reviews do not generate push notifications; skipping %s", notification.id)
        return
    if not settings.vapid_public_key or not settings.vapid_private_key:
        logger.info("Web Push is disabled; skipping %s %s", notification.type, notification.id)
        return

    if notification.type not in _ACTIVITY_COPY:
        logger.warning("No Web Push copy configured for activity type %s", notification.type)
        return

    try:
        statement = select(push_subscriptions).where(
            push_subscriptions.c.user_id.in_(notification.recipients)
        )
        with engine.connect() as connection:
            subscriptions = connection.execute(statement).mappings().all()
    except SQLAlchemyError:
        logger.exception(
            "Could not look up subscriptions for %s %s", notification.type, notification.id
        )
        return

    if not subscriptions:
        return

    title, body = _ACTIVITY_COPY[notification.type]
    payload = json.dumps(
        {
            "title": title,
            "body": body,
            "url": _activity_url(notification),
            "type": notification.type,
            "id": str(notification.id),
        }
    )

    for subscription in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription["endpoint"],
                    "keys": {
                        "p256dh": subscription["p256dh"],
                        "auth": subscription["auth"],
                    },
                },
                data=payload,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_subject},
            )
        except WebPushException as error:
            status_code = getattr(getattr(error, "response", None), "status_code", None)
            if status_code in (404, 410):
                _delete_subscription_by_endpoint(subscription["endpoint"])
            else:
                logger.warning(
                    "Push delivery failed for %s %s: %s",
                    notification.type,
                    notification.id,
                    error,
                )
        except Exception:
            logger.exception(
                "Unexpected error delivering push for %s %s",
                notification.type,
                notification.id,
            )
