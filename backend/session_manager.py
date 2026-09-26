import uuid
import datetime
import threading
from typing import List, Dict, Optional

class CallSession:
    def __init__(self, session_id: str, speaker_id: Optional[str] = None, analysis_type: str = "live_call"):
        self.session_id: str = session_id
        self.speaker_id: Optional[str] = speaker_id
        self.analysis_type: str = analysis_type  # "live_call", "snapshot", "desktop_monitor", "websocket"
        now_iso = datetime.datetime.utcnow().isoformat()
        self.start_time: str = now_iso
        self.last_active_time: str = now_iso
        self.risk_history: List[float] = []
        self.chunks_analyzed: int = 0
        self.status: str = "active"
        self.peak_risk: float = 0.0  # Track highest risk seen in this session
        self.model_breakdown: Dict = {}  # Last model scores {lfcc, wavlm, rawnet2, bio}
        self._lock = threading.RLock()
    
    def add_risk_score(self, score: float) -> None:
        """Appends a new risk score and updates chunk count and activity timestamp."""
        with self._lock:
            self.risk_history.append(score)
            self.chunks_analyzed += 1
            self.peak_risk = max(self.peak_risk, score)
            self.last_active_time = datetime.datetime.utcnow().isoformat()

    def get_current_risk(self) -> float:
        """Returns the exponential moving average of recent scores."""
        with self._lock:
            if not self.risk_history:
                return 0.0
            
            alpha = 0.3
            ema = self.risk_history[0]
            for score in self.risk_history[1:]:
                ema = alpha * score + (1 - alpha) * ema
            return float(ema)

    def get_risk_level(self) -> str:
        """
        Returns risk level based on the current EMA score (0-100 scale).
        Aligned with documentation:
        - LOW: 0.0 - 29.9
        - MEDIUM: 30.0 - 69.9
        - HIGH: 70.0 - 100.0
        """
        risk = self.get_current_risk()
        if risk < 30.0:
            return "LOW"
        elif risk < 70.0:
            return "MEDIUM"
        else:
            return "HIGH"
            
    def to_dict(self) -> Dict:
        """Returns the session as a dictionary."""
        with self._lock:
            return {
                "session_id": self.session_id,
                "speaker_id": self.speaker_id or "Anonymous_Caller",
                "analysis_type": self.analysis_type,
                "status": self.status,
                "start_time": self.start_time,
                "last_active_time": self.last_active_time,
                "chunks_analyzed": self.chunks_analyzed,
                "current_risk": self.get_current_risk(),
                "peak_risk": self.peak_risk,
                "risk_level": self.get_risk_level(),
                "risk_history": list(self.risk_history),
                "model_breakdown": dict(self.model_breakdown)
            }

class SessionManager:
    def __init__(self, max_sessions: int = 100):
        self.sessions: Dict[str, CallSession] = {}
        self.max_sessions = max_sessions
        self._lock = threading.RLock()
        
    def _evict_oldest_or_closed_session(self) -> None:
        """
        Evicts a session when max capacity is reached:
        1. Prioritize sessions with status == 'closed' (oldest closed first).
        2. If all are active, evict the least recently active session.
        """
        if not self.sessions:
            return

        closed_sessions = [
            (sid, sess) for sid, sess in self.sessions.items()
            if sess.status == "closed"
        ]
        if closed_sessions:
            oldest_closed_id = min(closed_sessions, key=lambda item: item[1].last_active_time)[0]
            del self.sessions[oldest_closed_id]
            return

        oldest_active_id = min(self.sessions.items(), key=lambda item: item[1].last_active_time)[0]
        del self.sessions[oldest_active_id]

    def create_session(self, speaker_id: Optional[str] = None, session_id: Optional[str] = None, analysis_type: str = "live_call") -> str:
        with self._lock:
            sid = session_id or str(uuid.uuid4())
            if len(self.sessions) >= self.max_sessions:
                self._evict_oldest_or_closed_session()
            self.sessions[sid] = CallSession(sid, speaker_id, analysis_type=analysis_type)
            return sid
        
    def get_session(self, session_id: str) -> Optional[CallSession]:
        with self._lock:
            return self.sessions.get(session_id)
        
    def list_sessions(self) -> List[Dict]:
        with self._lock:
            sessions = [session.to_dict() for session in self.sessions.values()]
            sessions.sort(key=lambda s: s.get("last_active_time", s.get("start_time", "")), reverse=True)
            return sessions
        
    def update_session(self, session_id: str, risk_score: float, speaker_id: Optional[str] = None, model_breakdown: Optional[Dict] = None) -> None:
        with self._lock:
            session = self.sessions.get(session_id)
            if session:
                if speaker_id and (not session.speaker_id or session.speaker_id == "Anonymous_Caller"):
                    session.speaker_id = speaker_id
                if model_breakdown:
                    session.model_breakdown = model_breakdown
                session.add_risk_score(risk_score)
            
    def close_session(self, session_id: str) -> None:
        with self._lock:
            if session_id in self.sessions:
                sess = self.sessions[session_id]
                sess.status = "closed"
                sess.last_active_time = datetime.datetime.utcnow().isoformat()
