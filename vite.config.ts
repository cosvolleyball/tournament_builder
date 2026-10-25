import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local development uses '/', while GitHub Pages publishes the built site
// under https://cosvolleyball.github.io/tournament_builder/ .
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/tournament_builder/' : '/',
}));
