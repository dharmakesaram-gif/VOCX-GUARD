import uuid
import datetime
from typing import List, Dict, Optional

class CallSession:
    def __init__(self, session_id: str, speaker_id: Optional[str] = None):
        self.session_id: str = session_id
        self.speaker_id: Optional[str] = speaker_id
        self.start_time: str = datetime.datetime.utcnow().isoformat()
        self.risk_history: List[float] = []
        self.chunks_analyzed: int = 0
        self.status: str = "active"
    
    def add_risk_score(self, score: float) -> None:
        """Appends a new risk score and updates the chunk count."""
        self.risk_history.append(score)
        self.chunks_analyzed += 1

    def get_current_risk(self) -> float:
        """Returns the exponential moving average of recent scores."""
        if not self.risk_history:
            return 0.0
        
        alpha = 0.3
        ema = self.risk_history[0]
        for score in self.risk_history[1:]:
            ema = alpha * score + (1 - alpha) * ema
        return ema

    def get_risk_level(self) -> str:
        """Returns risk level based on the current EMA score."""
        risk = self.get_current_risk()
        if risk < 35.0:
            return "LOW"
        elif risk < 50.0:
            return "MEDIUM"
        else:
            return "HIGH"
            
    def to_dict(self) -> Dict:
        """Returns the session as a dictionary."""
        return {
            "session_id": self.session_id,
            "speaker_id": self.speaker_id or "Anonymous_Caller",
            "status": self.status,
            "start_time": self.start_time,
            "chunks_analyzed": self.chunks_analyzed,
            "current_risk": self.get_current_risk(),
            "risk_level": self.get_risk_level(),
            "risk_history": self.risk_history
        }

class SessionManager:
    def __init__(self, max_sessions: int = 100):
        self.sessions: Dict[str, CallSession] = {}
        self.max_sessions = max_sessions
        
    def create_session(self, speaker_id: Optional[str] = None) -> str:
        session_id = str(uuid.uuid4())
        # Trim oldest sessions if capacity exceeded
        if len(self.sessions) >= self.max_sessions:
            oldest_id = next(iter(self.sessions))
            del self.sessions[oldest_id]
        self.sessions[session_id] = CallSession(session_id, speaker_id)
        return session_id
        
    def get_session(self, session_id: str) -> Optional[CallSession]:
        return self.sessions.get(session_id)
        
    def list_sessions(self) -> List[Dict]:
        return [session.to_dict() for session in self.sessions.values()]
        
    def update_session(self, session_id: str, risk_score: float) -> None:
        session = self.get_session(session_id)
        if session:
            session.add_risk_score(risk_score)
            
    def close_session(self, session_id: str) -> None:
        if session_id in self.sessions:
            self.sessions[session_id].status = "closed"
