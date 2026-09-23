"""Чат с ассистентом: ответ целиком и стримом. Образец роутера для новых фич."""

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import llm, sse

router = APIRouter(prefix="/api/chat", tags=["chat"])

SYSTEM_PROMPT = "Ты полезный ассистент. Отвечай кратко и по-русски."


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=20_000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=50)


class ChatReply(BaseModel):
    reply: str


def _to_llm(req: ChatRequest) -> list[llm.Message]:
    return [{"role": "system", "content": SYSTEM_PROMPT}] + [m.model_dump() for m in req.messages]


@router.post("")
async def chat(req: ChatRequest) -> ChatReply:
    return ChatReply(reply=await llm.complete(_to_llm(req)))


@router.post("/stream")
async def chat_stream(req: ChatRequest) -> StreamingResponse:
    return sse.stream_text(llm.stream(_to_llm(req)))
