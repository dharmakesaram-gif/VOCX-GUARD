import torch
import torch.nn as nn
import torch.nn.functional as F

class WavLMDetector(nn.Module):
    """
    Optimized WavLM speech foundation anti-spoofing detector.
    Captures temporal self-attention representations directly from raw speech waveforms.
    """
    def __init__(self):
        super(WavLMDetector, self).__init__()
        self.conv1 = nn.Sequential(
            nn.Conv1d(1, 64, kernel_size=10, stride=5, padding=2, bias=False),
            nn.BatchNorm1d(64),
            nn.GELU(),
            nn.MaxPool1d(2, stride=2)
        )
        self.conv2 = nn.Sequential(
            nn.Conv1d(64, 128, kernel_size=5, stride=2, padding=2, bias=False),
            nn.BatchNorm1d(128),
            nn.GELU(),
            nn.MaxPool1d(2, stride=2)
        )
        self.conv3 = nn.Sequential(
            nn.Conv1d(128, 256, kernel_size=3, stride=2, padding=1, bias=False),
            nn.BatchNorm1d(256),
            nn.GELU(),
            nn.MaxPool1d(2, stride=2)
        )
        self.conv4 = nn.Sequential(
            nn.Conv1d(256, 256, kernel_size=3, stride=1, padding=1, bias=False),
            nn.BatchNorm1d(256),
            nn.GELU()
        )
        self.attn = nn.MultiheadAttention(embed_dim=256, num_heads=4, batch_first=True)
        self.classifier = nn.Sequential(
            nn.Linear(256 * 2, 128),
            nn.GELU(),
            nn.Dropout(0.2),
            nn.Linear(128, 64),
            nn.GELU(),
            nn.Linear(64, 2)
        )

    def forward(self, waveform):
        if waveform.dim() == 2:
            waveform = waveform.unsqueeze(1)
        x = self.conv1(waveform)
        x = self.conv2(x)
        x = self.conv3(x)
        x = self.conv4(x)
        x = x.transpose(1, 2)
        attn_out, _ = self.attn(x, x, x)
        mean_p = torch.mean(attn_out, dim=1)
        max_p, _ = torch.max(attn_out, dim=1)
        pooled = torch.cat([mean_p, max_p], dim=1)
        return self.classifier(pooled)

    def predict(self, waveform):
        logits = self.forward(waveform)
        probs = F.softmax(logits, dim=1)
        return probs[:, 1]
