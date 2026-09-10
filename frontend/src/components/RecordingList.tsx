import React from 'react';
import { RecordingItem } from '../types';

interface RecordingListProps {
  recordings: RecordingItem[];
  currentPlayingId?: string;
  onPlay: (item: RecordingItem) => void;
}

export const RecordingList: React.FC<RecordingListProps> = ({
  recordings,
  currentPlayingId,
  onPlay
}) => {
  const formatDuration = (ms: number): string => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'READY':
        return <span className="badge badge-ready">READY</span>;
      case 'PROCESSING':
        return <span className="badge badge-processing">PROCESSING</span>;
      case 'FAILED':
        return <span className="badge badge-failed">FAILED</span>;
      case 'RECEIVED':
      default:
        return <span className="badge badge-received">RECEIVED</span>;
    }
  };

  if (recordings.length === 0) {
    return (
      <div className="card empty-state">
        <h3>No Recordings Yet</h3>
        <p>Waiting for uploads from ZY04 badge on <code>POST /sca/recordupload</code>.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="table-responsive">
        <table className="recordings-table" id="recordings-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Session</th>
              <th>File</th>
              <th>Time</th>
              <th>Duration</th>
              <th>Status</th>
              <th style={{ textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {recordings.map((rec) => {
              const isPlaying = currentPlayingId === rec.record_id;
              const isPlayable = rec.status === 'READY';

              return (
                <tr key={rec.record_id}>
                  <td>
                    <strong>{rec.device_sn}</strong>
                  </td>
                  <td>
                    <code>{rec.session_id}</code>
                  </td>
                  <td>{rec.file_name || '-'}</td>
                  <td>{formatTime(rec.created_at)}</td>
                  <td>{formatDuration(rec.duration_ms)}</td>
                  <td>{getStatusBadge(rec.status)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="btn-play"
                      disabled={!isPlayable}
                      onClick={() => onPlay(rec)}
                    >
                      {isPlaying ? '❚❚ Playing' : '▶ Play'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
