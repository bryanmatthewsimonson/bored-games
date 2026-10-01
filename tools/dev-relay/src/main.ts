import { startDevRelay } from './server.ts';

const relay = await startDevRelay({ port: 7777 });
console.log(`dev relay on ${relay.url}`);
