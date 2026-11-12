from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.dependencies import get_current_session, require_trusted_origin
from app.core.config import settings
from app.schemas.push import PushSubscriptionRequest, VapidKeyResponse
from app.services import push_subscriptions as push_store
from app.services.auth import AuthenticatedSession

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-key", response_model=VapidKeyResponse)
def vapid_key():
    """Provide the public key the browser needs to create a Push subscription."""
    if not settings.vapid_public_key:
        raise HTTPException(status_code=503, detail="Push notifications are not configured")
    return VapidKeyResponse(public_key=settings.vapid_public_key)


@router.post(
    "/subscriptions", status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_trusted_origin)],
)
def subscribe(
    data: PushSubscriptionRequest,
    session: Annotated[AuthenticatedSession, Depends(get_current_session)],
):
    """Save or transfer this browser endpoint to the signed-in user."""
    try:
        push_store.save_subscription(
            user_id=session.user_id, endpoint=str(data.endpoint),
            p256dh=data.keys.p256dh, auth=data.keys.auth,
        )
    except push_store.PushStoreError as error:
        raise HTTPException(status_code=503, detail="Push subscription service unavailable") from error
    return {"status": "subscribed"}


@router.delete(
    "/subscriptions", status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_trusted_origin)],
)
def unsubscribe(
    session: Annotated[AuthenticatedSession, Depends(get_current_session)],
    endpoint: Annotated[str, Query(...)],
):
    """Remove the current user's endpoint when Push is disabled or logout occurs."""
    try:
        push_store.delete_subscription(user_id=session.user_id, endpoint=endpoint)
    except push_store.PushStoreError as error:
        raise HTTPException(status_code=503, detail="Push subscription service unavailable") from error
