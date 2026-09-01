import './style.css';
import { GameApp } from './app/GameApp';
import { initPwaInstall } from './ui/PwaInstall';

const host = document.getElementById('app');
if (!host) throw new Error('Missing #app element');

initPwaInstall();

GameApp.create(host).catch((err: unknown) => {
  console.error(err);
  const msg = document.createElement('pre');
  msg.className = 'fatal-error';
  msg.textContent = `Failed to start Orbit Simulator:\n${String(err)}`;
  document.body.appendChild(msg);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* installability is optional */
    });
  });
}
