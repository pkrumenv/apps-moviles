"""Private Lambda handler that sends Web Push for resolved activity recipients."""

import json
import logging

from pywebpush import WebPushException, webpush

from app.core.config import settings
from app.notification_event import NotificationEvent
from app.services.push_subscriptions import (
    PushStoreError,
    delete_expired_subscription,
    subscriptions_for_users,
)

logger = logging.getLogger(__name__)

_COPY = {
    "visit": ("Nueva visita", "Alguien que sigues registró una visita."),
    "photo": ("Nueva foto", "Alguien que sigues publicó fotos."),
    "evaluation": ("Nueva evaluación", "Alguien que sigues evaluó un restaurante."),
}


def _activity_url(activity: NotificationEvent) -> str:
    """Build the React route; photo groups resolve through their feed activity."""
    if activity.type == "photo":
        return f"/feed?activity={activity.id}"
    route = {"visit": "visits", "evaluation": "evaluations"}.get(activity.type, "feed")
    return f"/{route}/{activity.id}"


def handler(event, context):
    """Send to every active subscription and isolate failures per endpoint."""
    del context
    activity = NotificationEvent.from_payload(event)
    if not settings.notifications_enabled:
        return {"status": "disabled", "recipients": len(activity.recipients), "sent": 0}
    if not activity.recipients or activity.type == "review":
        return {"status": "ok", "recipients": len(activity.recipients), "sent": 0}
    if not settings.vapid_public_key or not settings.vapid_private_key or not settings.vapid_subject:
        logger.error("Web Push enabled without complete VAPID configuration")
        return {"status": "ok", "recipients": len(activity.recipients), "sent": 0, "failed": 0}
    copy = _COPY.get(activity.type)
    if copy is None:
        logger.info("No Push message configured for activity type %s", activity.type)
        return {"status": "ok", "recipients": len(activity.recipients), "sent": 0}

    try:
        subscriptions = subscriptions_for_users(activity.recipients)
    except PushStoreError:
        logger.exception("Could not load Push subscriptions for activity %s", activity.id)
        return {"status": "ok", "recipients": len(activity.recipients), "sent": 0, "failed": 1}

    title, body = copy
    payload = json.dumps({
        "title": title,
        "body": body,
        "url": _activity_url(activity),
        "type": activity.type,
        "id": activity.id,
    })
    sent = failed = 0
    for subscription in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription["endpoint"],
                    "keys": {"p256dh": subscription["p256dh"], "auth": subscription["auth"]},
                },
                data=payload,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_subject},
                timeout=5,
                ttl=3600,
            )
            sent += 1
        except WebPushException as error:
            failed += 1
            response = getattr(error, "response", None)
            if getattr(response, "status_code", None) in (404, 410):
                delete_expired_subscription(subscription["endpoint"])
            else:
                logger.warning("Web Push delivery failed for activity %s", activity.id)
        except Exception as error:
            failed += 1
            logger.warning("Unexpected Web Push failure for activity %s (%s)", activity.id, type(error).__name__)
    return {"status": "ok", "recipients": len(activity.recipients), "sent": sent, "failed": failed}
