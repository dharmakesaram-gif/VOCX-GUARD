from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class EnrollRequest(BaseModel):
    speaker_id: str
    audio_base64: Optional[str] = None
    sample_rate: int = 16000
    allow_overwrite: Optional[bool] = False

class EnrollResponse(BaseModel):
    speaker_id: str
    status: str
    message: str
    embedding_dim: int

class AnalyzeRequest(BaseModel):
    audio_base64: str
    speaker_id: Optional[str] = None
    session_id: Optional[str] = None
    owner_speaker_id: Optional[str] = None
    filter_owner: Optional[bool] = False

class AnalyzeResponse(BaseModel):
    session_id: str
    risk_score: float
    risk_level: str
    acoustic_score: float
    speaker_score: float
    context_score: float
    is_spoofed: bool
    details: Dict[str, Any]
    timestamp: str

class SessionInfo(BaseModel):
    session_id: str
    speaker_id: Optional[str] = None
    analysis_type: Optional[str] = "live_call"
    status: Optional[str] = "active"
    start_time: str
    last_active_time: Optional[str] = None
    chunks_analyzed: int
    current_risk: float
    peak_risk: Optional[float] = 0.0
    risk_level: str
    risk_history: List[float]
    model_breakdown: Optional[Dict[str, Any]] = None

class SessionListResponse(BaseModel):
    sessions: List[SessionInfo]

class RiskScoreResponse(BaseModel):
    session_id: str
    current_risk: float
    risk_level: str
    risk_history: List[float]
