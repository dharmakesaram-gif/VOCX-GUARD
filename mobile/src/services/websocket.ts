const DEFAULT_WS_URL = process.env.EXPO_PUBLIC_WS_URL || 'ws://localhost:8000/ws/stream';

export class VocxGuardWebSocket {
  private ws: WebSocket | null = null;
  private onResultCallback: ((data: any) => void) | null = null;
  private onErrorCallback: ((error: any) => void) | null = null;

  private url: string = '';
  private reconnectTimer: any = null;

  connect(url: string = DEFAULT_WS_URL) {
    this.url = url;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('WebSocket Connected');
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    this.ws.onmessage = (e) => {
      if (this.onResultCallback) {
        try {
          const data = JSON.parse(e.data);
          this.onResultCallback(data);
        } catch (error) {
          console.error('Error parsing WS message', error);
        }
      }
    };

    this.ws.onerror = (e) => {
      if (this.onErrorCallback) {
        this.onErrorCallback(e);
      }
    };

    this.ws.onclose = (e) => {
      console.log('WebSocket Disconnected', e.reason);
      this.ws = null;
      this.reconnectTimer = setTimeout(() => {
        this.connect(this.url);
      }, 5000);
    };
  }

  sendAudioChunk(base64Audio: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'audio_chunk', data: base64Audio }));
    }
  }

  onResult(callback: (data: any) => void) {
    this.onResultCallback = callback;
  }

  onError(callback: (error: any) => void) {
    this.onErrorCallback = callback;
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsService = new VocxGuardWebSocket();
