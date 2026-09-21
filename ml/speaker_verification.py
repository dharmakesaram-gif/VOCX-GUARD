import torch
import torch.nn as nn
import torch.nn.functional as F

class SpeakerEncoder(nn.Module):
    """
    ECAPA-TDNN style speaker embedding extractor prototype.
    """
    def __init__(self, input_dim=80, hidden_dim=512, embedding_dim=192):
        super(SpeakerEncoder, self).__init__()
        
        # Simple TDNN (Time Delay Neural Network) style frontend using Conv1d
        self.tdnn1 = nn.Conv1d(input_dim, hidden_dim, kernel_size=5, dilation=1, padding=2)
        self.bn1 = nn.BatchNorm1d(hidden_dim)
        
        self.tdnn2 = nn.Conv1d(hidden_dim, hidden_dim, kernel_size=3, dilation=2, padding=2)
        self.bn2 = nn.BatchNorm1d(hidden_dim)
        
        self.tdnn3 = nn.Conv1d(hidden_dim, hidden_dim, kernel_size=3, dilation=3, padding=3)
        self.bn3 = nn.BatchNorm1d(hidden_dim)
        
        # Attentive Statistics Pooling
        self.attention = nn.Sequential(
            nn.Conv1d(hidden_dim, 128, kernel_size=1),
            nn.ReLU(),
            nn.BatchNorm1d(128),
            nn.Conv1d(128, hidden_dim, kernel_size=1),
            nn.Softmax(dim=2)
        )
        
        # Fully connected layer for embedding
        # Input to FC is hidden_dim * 2 (mean + std)
        self.fc = nn.Linear(hidden_dim * 2, embedding_dim)
        
    def forward(self, mel_spectrogram):
        """
        Forward pass to extract speaker embedding.
        
        Args:
            mel_spectrogram (torch.Tensor): Mel spectrogram of shape (batch, n_mels, time).
            
        Returns:
            torch.Tensor: Speaker embedding of shape (batch, embedding_dim).
        """
        x = F.relu(self.bn1(self.tdnn1(mel_spectrogram)))
        x = F.relu(self.bn2(self.tdnn2(x)))
        x = F.relu(self.bn3(self.tdnn3(x)))
        
        # Attentive Statistics Pooling
        alpha = self.attention(x)
        
        mean = torch.sum(alpha * x, dim=2)
        # Add small epsilon for numerical stability in sqrt
        var = torch.sum(alpha * x**2, dim=2) - mean**2
        std = torch.sqrt(torch.clamp(var, min=1e-8))
        
        # Concatenate mean and std
        stats = torch.cat((mean, std), dim=1)
        
        # Embedding extraction
        embedding = self.fc(stats)
        
        return embedding

class SpeakerVerifier:
    """Speaker verification engine."""
    
    def __init__(self, threshold: float = 0.65):
        """
        Initialize the SpeakerVerifier.
        
        Args:
            threshold (float): Threshold for cosine similarity to consider it a match.
        """
        self.encoder = SpeakerEncoder()
        self.encoder.eval() # Set to evaluation mode
        self.threshold = threshold
        self.voiceprints = {} # Dictionary mapping speaker_id to embedding tensor
        
    def compute_embedding(self, mel_spec: torch.Tensor) -> torch.Tensor:
        """
        Compute normalized speaker embedding.
        
        Args:
            mel_spec (torch.Tensor): Mel spectrogram of shape (batch, n_mels, time).
            
        Returns:
            torch.Tensor: Normalized embedding vector.
        """
        with torch.no_grad():
            embedding = self.encoder(mel_spec)
            # Normalize embedding
            embedding = F.normalize(embedding, p=2, dim=1)
        return embedding

    def enroll(self, speaker_id: str, audio_features: list[torch.Tensor]) -> None:
        """
        Enroll a new speaker by computing and storing average voiceprint.
        
        Args:
            speaker_id (str): Unique identifier for the speaker.
            audio_features (list[torch.Tensor]): List of mel spectrograms for enrollment.
        """
        embeddings = []
        for feat in audio_features:
            emb = self.compute_embedding(feat)
            embeddings.append(emb)
            
        if embeddings:
            # Average embeddings to create a robust voiceprint
            avg_emb = torch.mean(torch.stack(embeddings), dim=0)
            # Re-normalize
            avg_emb = F.normalize(avg_emb, p=2, dim=1)
            self.voiceprints[speaker_id] = avg_emb
            
    def cosine_similarity(self, emb1: torch.Tensor, emb2: torch.Tensor) -> float:
        """
        Compute cosine similarity between two embeddings.
        
        Args:
            emb1 (torch.Tensor): First embedding.
            emb2 (torch.Tensor): Second embedding.
            
        Returns:
            float: Cosine similarity score [-1.0, 1.0].
        """
        return F.cosine_similarity(emb1, emb2).item()
        
    def verify(self, speaker_id: str, mel_spec: torch.Tensor) -> tuple[bool, float]:
        """
        Verify if the given audio matches the enrolled speaker.
        
        Args:
            speaker_id (str): Claimed speaker ID.
            mel_spec (torch.Tensor): Mel spectrogram of the audio to verify.
            
        Returns:
            tuple[bool, float]: (is_match, similarity_score)
        """
        if speaker_id not in self.voiceprints:
            raise ValueError(f"Speaker {speaker_id} is not enrolled.")
            
        claimed_voiceprint = self.voiceprints[speaker_id]
        test_embedding = self.compute_embedding(mel_spec)
        
        similarity = self.cosine_similarity(claimed_voiceprint, test_embedding)
        is_match = similarity >= self.threshold
        
        return is_match, similarity
        
    @property
    def enrolled_speakers(self) -> list[str]:
        """List of enrolled speaker IDs."""
        return list(self.voiceprints.keys())
