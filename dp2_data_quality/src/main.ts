import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

// Named for the host page rather than the generic "app": the bundle is
// embedded in dp2.lsst.io, whose theme owns the surrounding markup.
const target = document.getElementById('dp2-data-quality');

const app = target ? mount(App, { target }) : null;

export default app;
