import React, { useEffect, useRef } from 'react';
import { RecordingItem } from '../types';
import { getAudioUrl } from '../api';

interface AudioPlayerProps {
  recording: RecordingItem | null;
  onClose?: () => void;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ recording, onClose }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (recording && audioRef.current) {
      audioRef.current.load();
      audioRef.current.play().catch(() => {
        // Autoplay may be restricted by browser
      });
    }
  }, [recording]);

  if (!recording) return null;

  const audioSrc = getAudioUrl(recording.record_id);

  return (
    <div className="audio-player-panel" id="active-audio-player">
      <div className="player-info">
        <span className="player-title">
          {recording.device_sn} — Session {recording.session_id}
        </span>
        <span className="player-sub">
          Record ID: {recording.record_id}
        </span>
      </div>

      <div className="player-controls">
        <audio ref={audioRef} controls autoPlay src={audioSrc}>
          Your browser does not support the audio element.
        </audio>
      </div>

      {onClose && (
        <button
          className="btn-refresh"
          onClick={onClose}
          style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
        >
          ✕ Close
        </button>
      )}
    </div>
  );
};
