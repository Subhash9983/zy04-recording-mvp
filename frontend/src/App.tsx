import { useState, useEffect, useCallback } from 'react';
import { RecordingItem } from './types';
import { fetchRecordings } from './api';
import { RecordingList } from './components/RecordingList';
import { AudioPlayer } from './components/AudioPlayer';

export function App() {
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeRecording, setActiveRecording] = useState<RecordingItem | null>(null);

  const loadRecordings = useCallback(async () => {
    try {
      const data = await fetchRecordings();
      setRecordings(data);
    } catch (err) {
      console.error('Failed to load recordings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecordings();
    const interval = setInterval(loadRecordings, 5000);
    return () => clearInterval(interval);
  }, [loadRecordings]);

  const handlePlay = (item: RecordingItem) => {
    setActiveRecording(item);
  };

  return (
    <div className="dashboard-container">
      <header className="header-bar">
        <div className="header-title">
          <h1>ZY04 Recording Dashboard</h1>
          <p>Real-time audio uploads and playback from ZY04 Smart Badges</p>
        </div>
        <div className="header-actions">
          <button className="btn-refresh" onClick={loadRecordings} disabled={loading}>
            {loading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </header>

      <main>
        <RecordingList
          recordings={recordings}
          currentPlayingId={activeRecording?.record_id}
          onPlay={handlePlay}
        />
      </main>

      <AudioPlayer
        recording={activeRecording}
        onClose={() => setActiveRecording(null)}
      />
    </div>
  );
}

export default App;
