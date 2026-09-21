import torch
import torch.nn as nn
import torch.nn.functional as F

class MaxFeatureMap(nn.Module):
    """
    Max Feature Map (MFM) activation function.
    Splits the channels in half and takes the element-wise maximum.
    """
    def forward(self, x):
        # x shape: (batch_size, channels, freq, time)
        channels = x.size(1)
        # Split channels in half
        x1, x2 = torch.split(x, channels // 2, dim=1)
        return torch.max(x1, x2)

class LCNN(nn.Module):
    """
    Light CNN (LCNN) architecture using LFCC features for anti-spoofing.
    """
    def __init__(self):
        super(LCNN, self).__init__()
        
        # Input shape: (batch, 1, n_lfcc, time_frames)
        # We assume n_lfcc is the height and time_frames is the width
        
        self.conv1 = nn.Conv2d(1, 64, kernel_size=5, stride=1, padding=2)
        self.mfm1 = MaxFeatureMap()
        self.pool1 = nn.MaxPool2d(kernel_size=2, stride=2, padding=1)
        
        self.conv2 = nn.Conv2d(32, 64, kernel_size=1, stride=1, padding=0)
        self.mfm2 = MaxFeatureMap()
        self.bn2 = nn.BatchNorm2d(32)
        
        self.conv3 = nn.Conv2d(32, 96, kernel_size=3, stride=1, padding=1)
        self.mfm3 = MaxFeatureMap()
        self.pool3 = nn.MaxPool2d(kernel_size=2, stride=2, padding=1)
        
        self.conv4 = nn.Conv2d(48, 96, kernel_size=1, stride=1, padding=0)
        self.mfm4 = MaxFeatureMap()
        self.bn4 = nn.BatchNorm2d(48)
        
        self.conv5 = nn.Conv2d(48, 128, kernel_size=3, stride=1, padding=1)
        self.mfm5 = MaxFeatureMap()
        self.pool5 = nn.MaxPool2d(kernel_size=2, stride=2, padding=1)
        
        # Adaptive pooling to handle variable length inputs
        self.adaptive_pool = nn.AdaptiveAvgPool2d((4, 4))
        
        # Fully connected layers
        self.fc1 = nn.Linear(64 * 4 * 4, 160)
        self.mfm6 = MaxFeatureMap() # MaxFeatureMap for 1D works slightly differently, we'll apply it manually or adapt
        self.bn6 = nn.BatchNorm1d(80)
        
        self.fc2 = nn.Linear(80, 2) # 2 classes: Genuine, Spoof
        
    def forward(self, x):
        """
        Forward pass.
        
        Args:
            x (torch.Tensor): Input tensor of shape (batch, 1, n_lfcc, time_frames)
            
        Returns:
            torch.Tensor: Logits for 2 classes.
        """
        if x.dim() == 2:
            x = x.unsqueeze(0).unsqueeze(1)
        elif x.dim() == 3:
            x = x.unsqueeze(1)

        x = self.conv1(x)
        x = self.mfm1(x)
        x = self.pool1(x)
        
        x = self.conv2(x)
        x = self.mfm2(x)
        x = self.bn2(x)
        
        x = self.conv3(x)
        x = self.mfm3(x)
        x = self.pool3(x)
        
        x = self.conv4(x)
        x = self.mfm4(x)
        x = self.bn4(x)
        
        x = self.conv5(x)
        x = self.mfm5(x)
        x = self.pool5(x)
        
        x = self.adaptive_pool(x)
        x = torch.flatten(x, 1)
        
        x = self.fc1(x)
        
        # 1D MaxFeatureMap equivalent
        channels = x.size(1)
        x1, x2 = torch.split(x, channels // 2, dim=1)
        x = torch.max(x1, x2)
        
        x = self.bn6(x)
        x = self.fc2(x)
        
        return x
        
    @torch.no_grad()
    def predict(self, x):
        """
        Predict spoof probability.
        Guaranteed to run in inference mode without gradient tracking,
        handling NaN safeguards and clamping probabilities to [0.0, 1.0].
        
        Args:
            x (torch.Tensor): Input tensor.
            
        Returns:
            torch.Tensor: Probability of being spoofed (class 1).
        """
        was_training = self.training
        self.eval()
        try:
            logits = self.forward(x)
            probs = F.softmax(logits, dim=1)
            probs = torch.nan_to_num(probs, nan=0.0, posinf=1.0, neginf=0.0)
            return torch.clamp(probs[:, 1], 0.0, 1.0)
        finally:
            if was_training:
                self.train()
