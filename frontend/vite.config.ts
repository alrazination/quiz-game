import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// IMPORTANT: base must match your GitHub repository name exactly, e.g.
// if your repo is github.com/yourname/quiz-game, base is '/quiz-game/'.
// If you're deploying to a custom domain at the root, set base to '/'.
export default defineConfig({
  plugins: [react()],
  base: '/quiz-game/',
});
