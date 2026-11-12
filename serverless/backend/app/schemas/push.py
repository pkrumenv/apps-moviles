from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class PushSubscriptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: HttpUrl
    keys: PushSubscriptionKeys


class VapidKeyResponse(BaseModel):
    public_key: str
