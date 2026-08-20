import { useEffect, useState } from 'react';
import { PlayerApp } from './player/PlayerApp';
import { HostApp } from './host/HostApp';

// Simple hash-based routing so GitHub Pages needs zero server config:
//   https://you.github.io/quiz-game/        -> player
//   https://you.github.io/quiz-game/#host    -> host/projector screen
export function App() {
  const [isHost, setIsHost] = useState(window.location.hash === '#host');

  useEffect(() => {
    const onHashChange = () => setIsHost(window.location.hash === '#host');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return isHost ? <HostApp /> : <PlayerApp />;
}
