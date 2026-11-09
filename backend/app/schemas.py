"""Modelos Pydantic de la API."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Level = Literal["beginner", "intermediate", "expert"]


class FallacyRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    use_llm: bool = True


class SessionModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    problem_id: str = Field(default="", alias="problemId")
    level: Level = "intermediate"
    mastered: list[str] = []
    hints_used: dict[str, int] = Field(default_factory=dict, alias="hintsUsed")
    attempts: int = 0
    misconceptions: int = 0


class SocraticStart(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    problem_id: str = Field(default="", alias="problemId")
    level: Level = "intermediate"


class SocraticEvaluate(BaseModel):
    session: SessionModel
    text: str = Field(max_length=5000)
    history: list[dict] = []
    use_llm: bool = True


class SocraticSession(BaseModel):
    session: SessionModel
    history: list[dict] = []
    use_llm: bool = True


class SocraticWhiteboard(BaseModel):
    session: SessionModel
    image_base64: str = Field(min_length=10, description="Imagen PNG o JPEG en base64 de la pizarra")
    history: list[dict] = []
    use_llm: bool = True


class ExplainRequest(BaseModel):
    selected_text: str = Field(default="", max_length=5000)
    context: str = Field(default="", max_length=50000)
    level: Level = "beginner"
    lang: Literal["es", "en"] = "es"
    use_llm: bool = True


class RagRequest(BaseModel):
    text: str = Field(min_length=1, max_length=200000)
    question: str = Field(min_length=1, max_length=1000)
    k: int = Field(default=3, ge=1, le=10)
    use_llm: bool = True


class NodeDraft(BaseModel):
    topic: str = Field(min_length=2)
    domain: str
    connected_nodes: list[str] = Field(min_length=1)
    complexity: int = Field(default=3, ge=1, le=5)
    authors: list[str] = []
    summary: str = ""
    year: int | None = None


class GraphExtractRequest(BaseModel):
    text: str = Field(min_length=10, max_length=50000)
    max_nodes: int = Field(default=3, ge=1, le=5)
    use_llm: bool = True


class FlashcardRequest(BaseModel):
    text: str = Field(min_length=10, max_length=50000)
    source: Literal["document", "socratic", "explanation", "general"] = "document"
    max_cards: int = Field(default=8, ge=1, le=20)
    level: Level = "intermediate"
    lang: Literal["es", "en"] = "es"
    use_llm: bool = True


class DebateTurnRequest(BaseModel):
    thinker_id: str
    opponent_id: str
    topic: str
    history: list[dict] = []
    user_intervention: str | None = None
    use_llm: bool = True


class ChallengeGenerateRequest(BaseModel):
    domain1: str = "any"
    domain2: str = "any"
    level: Level = "intermediate"
    use_llm: bool = True


class ChallengeEvaluateRequest(BaseModel):
    challenge_id: str = ""
    question: str
    user_answer: str
    user_reasoning: str = ""
    expected_explanation: str = ""
    domains: list[str] = []
    use_llm: bool = True




