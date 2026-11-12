from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.dependencies import get_current_session, require_trusted_origin
from app.core.config import settings
from app.schemas.push import PushSubscriptionRequest, VapidKeyResponse
from app.services import push as push_service
from app.services.auth import AuthenticatedSession

router = APIRouter(prefix="/push", tags=["push"])


@router.get(
    "/vapid-key",
    response_model=VapidKeyResponse,
    summary="Publish the public VAPID key the browser subscribes with",
    responses={200: {"description": "The public VAPID key."}},
)
def vapid_key():
    if not settings.vapid_public_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications are not configured on this deployment",
        )
    return VapidKeyResponse(public_key=settings.vapid_public_key)


@router.post(
    "/subscriptions",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_trusted_origin)],
    summary="Register this installation to receive notifications",
    responses={201: {"description": "The subscription was stored."}},
)
def subscribe(
    data: PushSubscriptionRequest,
    session: Annotated[AuthenticatedSession, Depends(get_current_session)],
):
    try:
        push_service.save_subscription(
            user_id=session.user_id,
            endpoint=data.endpoint,
            p256dh=data.keys.p256dh,
            auth=data.keys.auth,
        )
    except push_service.PushStoreError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push subscription service unavailable",
        ) from error
    return {"status": "subscribed"}


@router.delete(
    "/subscriptions",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_trusted_origin)],
    summary="Remove this installation's subscription",
    responses={204: {"description": "The subscription was removed."}},
)
def unsubscribe(
    session: Annotated[AuthenticatedSession, Depends(get_current_session)],
    endpoint: Annotated[str, Query(...)],
):
    try:
        push_service.delete_subscription(user_id=session.user_id, endpoint=endpoint)
    except push_service.PushStoreError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push subscription service unavailable",
        ) from error