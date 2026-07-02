import { Game } from './game/game.js';

const app = document.getElementById('app');
const canvas = document.getElementById('game');
window.__game = new Game(app, canvas); // exposed for the e2e smoke test
