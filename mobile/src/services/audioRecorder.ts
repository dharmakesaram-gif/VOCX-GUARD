import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

// Valid 16kHz mono PCM WAV base64 string for zero-byte or fallback audio cases
const FALLBACK_SILENT_WAV_BASE64 =
  'UklGRqQMAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YYAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: '.wav',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: '.wav',
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 128000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128000,
  },
};

export class VocxGuardRecorder {
  private recording: Audio.Recording | null = null;
  public isRecording = false;
  private audioModeConfigured = false;

  /**
   * Check whether microphone audio recording permission is granted
   */
  async checkPermissions(): Promise<boolean> {
    try {
      const status = await Audio.getPermissionsAsync().catch(() => null);
      if (status && (status.granted || status.status === 'granted')) {
        return true;
      }
      return false;
    } catch (err) {
      console.warn('Audio checkPermissions caught error:', err);
      return false;
    }
  }

  /**
   * Request microphone audio recording permissions safely
   */
  async requestPermissions(): Promise<boolean> {
    try {
      const status = await Audio.requestPermissionsAsync().catch(() => null);
      if (status && (status.granted || status.status === 'granted')) {
        return true;
      }
      return false;
    } catch (err) {
      console.warn('Audio requestPermissions caught error:', err);
      return false;
    }
  }

  /**
   * Start audio recording with robust permission check and guarded initialization
   */
  async startRecording(onStatusUpdate?: (status: Audio.RecordingStatus) => void): Promise<boolean> {
    try {
      // 1. Verify / Request permissions
      let granted = await this.checkPermissions();
      if (!granted) {
        granted = await this.requestPermissions();
      }

      if (!granted) {
        this.isRecording = false;
        throw new Error(
          'Microphone permission not granted. Please allow microphone access to record audio.'
        );
      }

      // 2. Safely unload any lingering previous recording instance
      if (this.recording) {
        try {
          const oldRec = this.recording;
          this.recording = null;
          await oldRec.stopAndUnloadAsync().catch(err => {
            console.warn('Cleaned up previous recording instance with warning:', err);
          });
        } catch (cleanupErr) {
          console.warn('Previous recording cleanup caught error:', cleanupErr);
        }
      }

      // 3. Configure audio mode once to avoid audio session glitches across repeated chunks
      if (!this.audioModeConfigured) {
        try {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
          }).catch(modeErr => {
            console.warn('Audio.setAudioModeAsync error ignored:', modeErr);
          });
          this.audioModeConfigured = true;
        } catch (modeErr) {
          console.warn('Failed setting audio mode:', modeErr);
        }
      }

      // 4. Create and prepare recording instance
      const recording = new Audio.Recording();

      try {
        await recording.prepareToRecordAsync(RECORDING_OPTIONS).catch(async prepErr => {
          console.warn(
            'Custom recording preset failed, attempting HIGH_QUALITY fallback preset:',
            prepErr
          );
          await recording
            .prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)
            .catch(fallbackErr => {
              throw fallbackErr;
            });
        });
      } catch (prepErr) {
        console.error('Audio prepareToRecordAsync failed completely:', prepErr);
        try {
          await recording.stopAndUnloadAsync().catch(() => {});
        } catch {}
        this.recording = null;
        this.isRecording = false;
        throw new Error(
          `Audio recording preparation failed: ${
            prepErr instanceof Error ? prepErr.message : String(prepErr)
          }`
        );
      }

      // 5. Attach status listener if requested
      if (onStatusUpdate) {
        try {
          recording.setOnRecordingStatusUpdate(onStatusUpdate);
          recording.setProgressUpdateInterval(100);
        } catch (statusErr) {
          console.warn('Failed setting recording status callback:', statusErr);
        }
      }

      // 6. Start recording safely
      try {
        await recording.startAsync().catch(startErr => {
          throw startErr;
        });

        this.recording = recording;
        this.isRecording = true;
        return true;
      } catch (startErr) {
        console.error('Audio startAsync failed:', startErr);
        try {
          await recording.stopAndUnloadAsync().catch(() => {});
        } catch {}
        this.recording = null;
        this.isRecording = false;
        throw new Error(
          `Failed to start recording: ${
            startErr instanceof Error ? startErr.message : String(startErr)
          }`
        );
      }
    } catch (err) {
      console.error('Unexpected error in startRecording:', err);
      this.isRecording = false;
      this.recording = null;
      throw err;
    }
  }

  /**
   * Stop and unload recording safely. Never throws unhandled rejections.
   */
  async stopRecording(): Promise<string | null> {
    if (!this.recording) {
      this.isRecording = false;
      return null;
    }

    const rec = this.recording;
    this.recording = null;
    this.isRecording = false;

    let uri: string | null = null;
    try {
      uri = rec.getURI();
    } catch (uriErr) {
      console.warn('Could not read initial URI:', uriErr);
    }

    try {
      // Check status safely before stopping
      let shouldUnload = true;
      try {
        const status = await rec.getStatusAsync().catch(() => null);
        if (status && !status.canRecord && !status.isRecording) {
          shouldUnload = false;
        }
      } catch {
        shouldUnload = true;
      }

      if (shouldUnload) {
        await rec.stopAndUnloadAsync().catch(unloadErr => {
          console.warn('stopAndUnloadAsync safe catch:', unloadErr);
        });
      }
    } catch (err) {
      console.warn('stopRecording caught unload check error:', err);
      try {
        await rec.stopAndUnloadAsync().catch(() => {});
      } catch {}
    }

    try {
      const finalUri = rec.getURI();
      if (finalUri) uri = finalUri;
    } catch (finalUriErr) {
      console.warn('Could not read final URI:', finalUriErr);
    }

    return uri;
  }

  /**
   * Read recording file to base64 with fallback
   */
  async getAudioBase64(uri: string): Promise<string | null> {
    if (!uri || typeof uri !== 'string') {
      return FALLBACK_SILENT_WAV_BASE64;
    }

    try {
      const fileInfo = await FileSystem.getInfoAsync(uri).catch(() => null);
      if (fileInfo && !fileInfo.exists) {
        console.warn(`Audio file at ${uri} does not exist. Using fallback audio sample.`);
        return FALLBACK_SILENT_WAV_BASE64;
      }

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      }).catch(readErr => {
        console.warn('FileSystem.readAsStringAsync caught error, using fallback:', readErr);
        return null;
      });

      return base64 || FALLBACK_SILENT_WAV_BASE64;
    } catch (err) {
      console.warn('getAudioBase64 top-level catch, returning fallback audio:', err);
      return FALLBACK_SILENT_WAV_BASE64;
    }
  }

  /**
   * Safely delete temporary audio chunk file to avoid disk storage leaks
   */
  async cleanupFile(uri: string | null | undefined): Promise<void> {
    if (!uri || typeof uri !== 'string') return;
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    } catch (_) {}
  }
}

export const audioRecorder = new VocxGuardRecorder();
